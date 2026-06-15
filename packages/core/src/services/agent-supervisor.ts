import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue, IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import type { Logger } from './logger.js';
import type { MetricsSink } from './metrics.js';

export type SupervisorState =
  | 'idle'
  | 'spawning'
  | 'running'
  | 'retrying'
  | 'terminating'
  | 'done'
  | 'blocked';

export interface SupervisorCfg {
  permissionMode: 'plan' | 'auto' | 'bypass';
  binaryPath: string;
  stallTimeoutMs: number;
  maxRetries: number;
  backoffMs: ReadonlyArray<number>;
  exitNoPrGraceMs?: number; // default 30_000
  /** Janela (ms) entre SIGTERM e SIGKILL ao encerrar um processo (§4.1). Default 5_000. */
  killGraceMs?: number;
  /** Nomes de env vars a não vazar para o agente (§12) — ex.: token do tracker. */
  redactEnvKeys?: string[];
}

/** Quantas linhas de output recente preservar para diagnóstico (§8.2). */
const DIAGNOSTIC_TAIL_LINES = 50;

/** Runtime de loop autônomo por issue (§17). Presença = modo loop. */
export interface LoopRuntime {
  maxIterations: number;
  completionPromise: string;
  validationCommand?: string;
  warningThresholdMs: number;
}

export interface SupervisorDeps {
  issue: Issue;
  agent: AgentDescriptor;
  workspace: WorkspaceInfo;
  prompt: string;
  correlationId: string;
  cli: CliPort;
  tracker: TrackerPort;
  store: StateStore;
  clock: Clock;
  log: Logger;
  cfg: SupervisorCfg;
  onDone?: (issueId: IssueId) => void;
  /**
   * Lê o instante (ms epoch) do último heartbeat cooperativo (§8.1). Default:
   * mtime do arquivo `workspace.heartbeatPath`, ou null se ainda não existir.
   * Injetável para testes determinísticos com clock falso.
   */
  readHeartbeat?: ((path: string) => number | null) | undefined;
  /** Sink de métricas (§13.2); opcional. */
  metrics?: MetricsSink | undefined;
  /** Runtime de loop autônomo (§17); ausente = single-shot. */
  loop?: LoopRuntime | undefined;
}

export class AgentSupervisor {
  state: SupervisorState = 'idle';
  private proc: AgentProcess | null = null;
  private lastOutputAt = 0;
  private retryCount = 0;
  private dispatchId: number | null = null;
  private retryHandle: TimerHandle | null = null;
  private killTimer: TimerHandle | null = null;
  private exited = false;
  private recentLines: string[] = [];
  private pendingLine = '';
  private firstStartedAtMs: number | null = null;
  private iteration = 0;
  private loopWarned = false;
  private stopping = false;

  constructor(private readonly deps: SupervisorDeps) {}

  get issueId(): IssueId {
    return this.deps.issue.id;
  }

  private get loopMode(): boolean {
    return this.deps.loop !== undefined;
  }

  start(): void {
    this.state = 'spawning';
    const startedAt = this.deps.clock.now().toISOString();
    if (this.firstStartedAtMs === null) this.firstStartedAtMs = this.deps.clock.now().getTime();
    let prompt: string;
    let attempt: number;
    if (this.loopMode) {
      if (this.iteration === 0) this.initCheckpoint();
      this.iteration += 1;
      attempt = this.iteration;
      prompt = this.buildIterationPrompt();
    } else {
      this.retryCount += 1;
      attempt = this.retryCount;
      prompt = this.deps.prompt;
    }
    this.dispatchId = this.deps.store.recordDispatch({
      issueId: this.deps.issue.id,
      agentId: this.deps.agent.id,
      attempt,
      startedAt,
      endedAt: null,
      exitCode: null,
      outcome: null,
      correlationId: this.deps.correlationId,
    });
    writeFileSync(this.deps.workspace.terminalLogPath, '');
    this.exited = false;
    this.recentLines = [];
    this.pendingLine = '';
    if (this.killTimer !== null) {
      this.deps.clock.clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    try {
      this.proc = this.deps.cli.spawn({
        binaryPath: this.deps.cfg.binaryPath,
        cwd: this.deps.workspace.path,
        prompt,
        permissionMode: this.deps.cfg.permissionMode,
        redactEnvKeys: this.deps.cfg.redactEnvKeys,
      });
    } catch (err) {
      // §4.1: falha de spawn do PTY conta como crash da issue, não derruba o daemon.
      this.deps.log.error({
        event: 'agent_crashed',
        issue_id: this.deps.issue.id,
        agent_id: this.deps.agent.id,
        exit_code: null,
        error: err instanceof Error ? err.message : String(err),
        correlation_id: this.deps.correlationId,
        message: `Falha ao spawnar PTY para ${this.deps.issue.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      this.deps.metrics?.recordCrash(this.deps.agent.id);
      this.markDispatchOutcome('crashed', null);
      this.scheduleRetry();
      return;
    }
    this.lastOutputAt = this.deps.clock.now().getTime();
    this.proc.onData((chunk) => {
      appendFileSync(this.deps.workspace.terminalLogPath, chunk);
      this.captureOutput(chunk);
      this.lastOutputAt = this.deps.clock.now().getTime();
    });
    this.proc.onExit((code) => {
      void this.onProcessExit(code);
    });
    this.state = 'running';
    this.deps.log.info({
      event: 'agent_running',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} rodando para a issue ${this.deps.issue.id}`,
    });
  }

  terminate(): void {
    if (this.state === 'done' || this.state === 'blocked' || this.state === 'terminating') {
      return;
    }
    this.stopping = true; // §17: encerra o loop em vez de iniciar nova iteração
    this.state = 'terminating';
    this.killWithEscalation();
    if (this.retryHandle !== null) {
      this.deps.clock.clearTimeout(this.retryHandle);
      this.retryHandle = null;
    }
  }

  /**
   * Encerra o processo de forma graciosa: SIGTERM e, se não sair dentro de
   * `killGraceMs`, SIGKILL (§4.1 hardening). Idempotente — o timer de grace é
   * cancelado quando o processo sai de fato (`exited`).
   */
  private killWithEscalation(): void {
    const target = this.proc;
    if (target === null || this.exited) return;
    target.kill('SIGTERM');
    const grace = this.deps.cfg.killGraceMs ?? 5_000;
    if (this.killTimer !== null) this.deps.clock.clearTimeout(this.killTimer);
    this.killTimer = this.deps.clock.setTimeout(() => {
      this.killTimer = null;
      // Não escalar se o processo já saiu ou se um novo dispatch (retry) começou.
      if (this.exited || this.proc !== target) return;
      this.deps.log.warn({
        event: 'agent_sigkilled',
        issue_id: this.deps.issue.id,
        agent_id: this.deps.agent.id,
        correlation_id: this.deps.correlationId,
        message: `Agente ${this.deps.agent.id} não saiu após SIGTERM — enviando SIGKILL`,
      });
      target.kill('SIGKILL');
    }, grace);
  }

  /** Mantém um ring buffer das últimas linhas para diagnóstico (§8.2). */
  private captureOutput(chunk: string): void {
    const text = this.pendingLine + chunk;
    const parts = text.split('\n');
    this.pendingLine = parts.pop() ?? '';
    for (const line of parts) {
      this.recentLines.push(line);
    }
    if (this.recentLines.length > DIAGNOSTIC_TAIL_LINES) {
      this.recentLines.splice(0, this.recentLines.length - DIAGNOSTIC_TAIL_LINES);
    }
  }

  private tailDiagnostics(): string {
    const lines = [...this.recentLines];
    if (this.pendingLine.length > 0) lines.push(this.pendingLine);
    return lines.slice(-DIAGNOSTIC_TAIL_LINES).join('\n');
  }

  async tick(): Promise<void> {
    if (this.state !== 'running') return;
    this.maybeWarnLongLoop();
    // §8.1: vivo = teve output no PTY OU atualizou o heartbeat cooperativo.
    // Só consideramos stall quando ambos os sinais estão silenciosos.
    const liveness = Math.max(this.lastOutputAt, this.lastHeartbeatAt());
    const ageMs = this.deps.clock.now().getTime() - liveness;
    if (ageMs > this.deps.cfg.stallTimeoutMs) {
      this.onStall();
      return;
    }
    // §17.3: em loop, a conclusão é sinalizada pelo checkpoint (não por PR);
    // a detecção de PR é o caminho single-shot (§7).
    if (this.loopMode) return;
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
    }
  }

  /** §17.5: alerta quando um loop ocupa o slot por tempo demais. */
  private maybeWarnLongLoop(): void {
    if (!this.loopMode || this.loopWarned || this.firstStartedAtMs === null) return;
    const elapsed = this.deps.clock.now().getTime() - this.firstStartedAtMs;
    if (elapsed <= (this.deps.loop?.warningThresholdMs ?? Number.POSITIVE_INFINITY)) return;
    this.loopWarned = true;
    this.deps.log.warn({
      event: 'loop_long_running',
      issue_id: this.deps.issue.id,
      iteration: this.iteration,
      elapsed_ms: elapsed,
      correlation_id: this.deps.correlationId,
      message: `Loop da issue ${this.deps.issue.id} ocupa slot há ${Math.round(elapsed / 3_600_000)}h (iteração ${this.iteration})`,
    });
  }

  private lastHeartbeatAt(): number {
    const read = this.deps.readHeartbeat ?? defaultReadHeartbeat;
    return read(this.deps.workspace.heartbeatPath) ?? 0;
  }

  private onStall(): void {
    this.deps.log.warn({
      event: 'agent_stalled',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      last_output: this.tailDiagnostics(),
      message: `Agente ${this.deps.agent.id} stall detectado para issue ${this.deps.issue.id}`,
    });
    this.markDispatchOutcome('stalled', null);
    if (this.loopMode) {
      // O kill dispara onExit → onIterationEnd avalia o checkpoint da iteração.
      this.killWithEscalation();
      return;
    }
    this.state = 'terminating';
    this.killWithEscalation();
    this.scheduleRetry();
  }

  private async onPRDetected(pr: import('../domain/pr.js').PullRequestRef): Promise<void> {
    this.deps.log.info({
      event: 'pr_detected',
      issue_id: this.deps.issue.id,
      pr_number: pr.number,
      correlation_id: this.deps.correlationId,
      message: `PR #${pr.number} detectado para issue ${this.deps.issue.id}`,
    });
    await this.deps.tracker.transitionState(
      this.deps.issue.id,
      'review_pending',
      `PR #${pr.number}`,
    );
    this.markDispatchOutcome('pr_opened', 0);
    this.observeDuration();
    this.state = 'done';
    this.deps.onDone?.(this.deps.issue.id);
  }

  /** Observa a duração total do dispatch (do 1º start ao estado terminal) — §13.2. */
  private observeDuration(): void {
    if (this.firstStartedAtMs === null) return;
    const seconds = (this.deps.clock.now().getTime() - this.firstStartedAtMs) / 1000;
    this.deps.metrics?.observeDispatchDuration(seconds);
  }

  private scheduleRetry(): void {
    if (this.retryCount > this.deps.cfg.maxRetries) {
      this.markBlocked('symphony:max-retries-exceeded');
      return;
    }
    const delay =
      this.deps.cfg.backoffMs[Math.min(this.retryCount - 1, this.deps.cfg.backoffMs.length - 1)] ??
      60_000;
    this.deps.log.info({
      event: 'agent_retrying',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      attempt: this.retryCount,
      delay_ms: delay,
      correlation_id: this.deps.correlationId,
      message: `Reagendando tentativa ${this.retryCount} em ${delay}ms`,
    });
    this.state = 'retrying';
    this.retryHandle = this.deps.clock.setTimeout(() => {
      this.start();
    }, delay);
  }

  private markBlocked(reason: string): void {
    this.state = 'blocked';
    this.observeDuration();
    const now = this.deps.clock.now().toISOString();
    const existing = this.deps.store.getIssue(this.deps.issue.id);
    if (existing) {
      this.deps.store.upsertIssue({
        ...existing,
        state: 'blocked',
        blockedReason: reason,
        finishedAt: now,
        lastSyncedAt: now,
      });
      this.deps.store.recordTransition({
        issueId: this.deps.issue.id,
        fromState: existing.state,
        toState: 'blocked',
        reason,
        evidence: null,
        correlationId: this.deps.correlationId,
        occurredAt: now,
      });
    }
    this.deps.log.error({
      event: 'agent_blocked',
      issue_id: this.deps.issue.id,
      reason,
      correlation_id: this.deps.correlationId,
      message: `Issue ${this.deps.issue.id} bloqueada: ${reason}`,
    });
    void this.deps.tracker.transitionState(this.deps.issue.id, 'blocked', reason);
    this.deps.onDone?.(this.deps.issue.id);
  }

  private markDispatchOutcome(
    outcome: 'stalled' | 'crashed' | 'exited_no_pr' | 'pr_opened',
    exitCode: number | null,
  ): void {
    if (this.dispatchId === null) return;
    this.deps.store.updateDispatchOutcome(
      this.dispatchId,
      outcome,
      exitCode,
      this.deps.clock.now().toISOString(),
    );
  }

  private async onProcessExit(code: number): Promise<void> {
    this.exited = true;
    if (this.killTimer !== null) {
      this.deps.clock.clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    if (this.loopMode) {
      this.markDispatchOutcome(code === 0 ? 'exited_no_pr' : 'crashed', code);
      if (this.stopping) {
        this.state = 'terminating';
        return;
      }
      await this.onIterationEnd();
      return;
    }
    if (this.state === 'terminating') {
      // já tratado (stall→kill ou cleanup externo)
      return;
    }
    if (code !== 0) {
      this.deps.log.error({
        event: 'agent_crashed',
        issue_id: this.deps.issue.id,
        agent_id: this.deps.agent.id,
        exit_code: code,
        correlation_id: this.deps.correlationId,
        last_output: this.tailDiagnostics(),
        message: `Agente ${this.deps.agent.id} crashou (exit ${code})`,
      });
      this.deps.metrics?.recordCrash(this.deps.agent.id);
      this.markDispatchOutcome('crashed', code);
      this.scheduleRetry();
      return;
    }
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
      return;
    }
    this.deps.log.warn({
      event: 'agent_exited_without_pr',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} encerrou exit 0 sem PR aberto`,
    });
    this.markDispatchOutcome('exited_no_pr', 0);
    this.scheduleRetry();
  }

  // ── Loop autônomo (§17) ────────────────────────────────────────────────

  private checkpointPath(): string {
    return join(this.deps.workspace.path, '.perseguir', 'checkpoint.md');
  }

  /** §17.3.1: cria o checkpoint antes da primeira iteração. */
  private initCheckpoint(): void {
    const path = this.checkpointPath();
    mkdirSync(dirname(path), { recursive: true });
    const promise = this.deps.loop?.completionPromise ?? 'DONE';
    writeFileSync(
      path,
      [
        `# Checkpoint — ${this.deps.issue.id}`,
        '',
        'Registre aqui o progresso entre iterações. A última linha sinaliza o estado:',
        `- \`${promise}\` quando o trabalho estiver completo e verificado;`,
        '- `BLOCKED: <motivo>` se você travar;',
        '- qualquer outra coisa → o orquestrador fará a próxima iteração.',
        '',
        '## Progresso',
        '',
      ].join('\n'),
    );
  }

  private readCheckpoint(): string {
    const path = this.checkpointPath();
    if (!existsSync(path)) return '';
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  }

  private readCheckpointLastLine(): string | null {
    const lines = this.readCheckpoint()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
  }

  private buildIterationPrompt(): string {
    const loop = this.deps.loop;
    if (!loop) return this.deps.prompt;
    const checkpoint = this.readCheckpoint();
    const parts = [
      this.deps.prompt,
      '',
      '# Loop autônomo — perseguir até o critério (§17)',
      '',
      `Iteração ${this.iteration} de ${loop.maxIterations}.`,
      '',
      '## Checkpoint atual (`.perseguir/checkpoint.md`)',
      '',
      checkpoint.trim().length > 0 ? checkpoint : '(vazio — primeira iteração)',
      '',
    ];
    if (loop.validationCommand) {
      parts.push(
        '## Comando de validação',
        '',
        `Rode \`${loop.validationCommand}\` para verificar o critério antes de declarar conclusão.`,
        '',
      );
    }
    parts.push(
      '## Condição de parada',
      '',
      `- Quando o trabalho estiver completo e verificado, escreva \`${loop.completionPromise}\` como ÚLTIMA linha de \`.perseguir/checkpoint.md\`.`,
      '- Se travar, escreva `BLOCKED: <motivo>` como última linha.',
      '- Caso contrário, registre o progresso no checkpoint; o orquestrador fará a próxima iteração.',
      '',
    );
    return parts.join('\n');
  }

  private async onIterationEnd(): Promise<void> {
    const loop = this.deps.loop;
    if (!loop) return;
    const last = this.readCheckpointLastLine();

    if (
      last !== null &&
      last.trim().toUpperCase() === loop.completionPromise.trim().toUpperCase()
    ) {
      await this.completeLoop();
      return;
    }

    const blocked = /^BLOCKED:\s*(.*)$/i.exec(last ?? '');
    if (blocked) {
      const motivo = (blocked[1] ?? '').trim() || 'sem motivo informado';
      this.deps.log.warn({
        event: 'loop_blocked',
        issue_id: this.deps.issue.id,
        iteration: this.iteration,
        correlation_id: this.deps.correlationId,
        message: `Loop da issue ${this.deps.issue.id} bloqueado pelo agente: ${motivo}`,
      });
      this.markBlocked(`symphony:loop-blocked: ${motivo}`);
      return;
    }

    if (this.iteration >= loop.maxIterations) {
      this.deps.log.warn({
        event: 'loop_max_iterations',
        issue_id: this.deps.issue.id,
        iteration: this.iteration,
        correlation_id: this.deps.correlationId,
        last_output: this.readCheckpointLastLine() ?? '',
        message: `Loop da issue ${this.deps.issue.id} esgotou ${loop.maxIterations} iterações`,
      });
      this.markBlocked('symphony:max-iterations-exceeded');
      return;
    }

    this.deps.log.info({
      event: 'loop_iteration_completed',
      issue_id: this.deps.issue.id,
      iteration: this.iteration,
      correlation_id: this.deps.correlationId,
      message: `Iteração ${this.iteration} concluída sem critério atingido — próxima iteração`,
    });
    this.start();
  }

  private async completeLoop(): Promise<void> {
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id).catch(() => null);
    const reason = pr
      ? `PR #${pr.number} (loop completo em ${this.iteration} iterações)`
      : `loop completo em ${this.iteration} iterações`;
    this.deps.log.info({
      event: 'loop_completed',
      issue_id: this.deps.issue.id,
      iteration: this.iteration,
      pr_number: pr?.number,
      correlation_id: this.deps.correlationId,
      message: `Loop da issue ${this.deps.issue.id} concluído (${this.iteration} iterações)`,
    });
    await this.deps.tracker.transitionState(this.deps.issue.id, 'review_pending', reason);
    this.markDispatchOutcome('pr_opened', 0);
    this.observeDuration();
    this.state = 'done';
    this.deps.onDone?.(this.deps.issue.id);
  }
}

/** Lê o mtime do arquivo de heartbeat em ms epoch; null se ainda não existir. */
function defaultReadHeartbeat(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
