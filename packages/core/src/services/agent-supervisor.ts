import { appendFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
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

  constructor(private readonly deps: SupervisorDeps) {}

  get issueId(): IssueId {
    return this.deps.issue.id;
  }

  start(): void {
    this.state = 'spawning';
    this.retryCount += 1;
    const startedAt = this.deps.clock.now().toISOString();
    if (this.firstStartedAtMs === null) this.firstStartedAtMs = this.deps.clock.now().getTime();
    this.dispatchId = this.deps.store.recordDispatch({
      issueId: this.deps.issue.id,
      agentId: this.deps.agent.id,
      attempt: this.retryCount,
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
        prompt: this.deps.prompt,
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
    // §8.1: vivo = teve output no PTY OU atualizou o heartbeat cooperativo.
    // Só consideramos stall quando ambos os sinais estão silenciosos.
    const liveness = Math.max(this.lastOutputAt, this.lastHeartbeatAt());
    const ageMs = this.deps.clock.now().getTime() - liveness;
    if (ageMs > this.deps.cfg.stallTimeoutMs) {
      this.onStall();
      return;
    }
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
    }
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
    this.state = 'terminating';
    this.killWithEscalation();
    this.markDispatchOutcome('stalled', null);
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
