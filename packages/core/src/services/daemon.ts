import { newCorrelationId } from '../domain/correlation.js';
import type { Issue, IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { CliPort } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { FactoryPort } from '../ports/factory.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { AgentSupervisor, type LoopRuntime, type SupervisorCfg } from './agent-supervisor.js';
import type { HarnessReport } from './harness-validator.js';
import { type IterationConfig, resolveIterationMode } from './iteration.js';
import type { Logger } from './logger.js';
import type { MetricsSink } from './metrics.js';
import { type PromptBuilder, PromptTooLargeError } from './prompt-builder.js';
import type { Reconciler } from './reconciler.js';
import type { Router } from './router.js';
import { type WorkspaceManager, WorktreeCreateFailed } from './workspace-manager.js';

export interface DaemonCfg extends SupervisorCfg {
  concurrentLimit: number;
}

/**
 * Política de re-validação de harness durante a operação (§16.4/§16.5). A
 * checagem inicial (§16.2/§16.3) é feita pelo comando `start` antes de subir
 * o loop; aqui tratamos o warning por dispatch quando o check foi pulado e a
 * re-validação periódica que dispara o modo drain.
 */
export interface DaemonHarnessPolicy {
  validator: { validate(): HarnessReport };
  /** Check pulado via --skip-harness-check (§16.4): emite warning por dispatch. */
  skipCheck: boolean;
  /** Re-valida a cada N dispatches (0 = desabilitado). */
  revalidateEveryDispatches: number;
  /** Re-valida a cada N ms (0 = desabilitado). */
  revalidateEveryMs: number;
}

export interface DaemonDeps {
  tracker: TrackerPort;
  cli: CliPort;
  factory: FactoryPort;
  store: StateStore;
  log: Logger;
  clock: Clock;
  workspaceManager: WorkspaceManager;
  router: Router;
  promptBuilder: PromptBuilder;
  reconciler: Reconciler;
  pollIntervalMs: number;
  cfg: DaemonCfg;
  /** Leitor de heartbeat cooperativo (§8.1) repassado aos supervisores. */
  readHeartbeat?: (path: string) => number | null;
  /** Sink de métricas (§13.2); opcional. */
  metrics?: MetricsSink;
  /** Política de harness-readiness (§16); opcional. */
  harness?: DaemonHarnessPolicy | undefined;
  /** Configuração de iteração (§17); ausente = sempre single-shot. */
  iteration?: IterationConfig | undefined;
}

export class Daemon {
  private readonly supervisors = new Map<IssueId, AgentSupervisor>();
  private timer: TimerHandle | null = null;
  private running = false;
  private dispatchPaused = false;
  private dispatchesSinceCheck = 0;
  private lastCheckAtMs = 0;

  constructor(private readonly deps: DaemonDeps) {}

  activeSupervisors(): Map<IssueId, AgentSupervisor> {
    return this.supervisors;
  }

  /** Pausa o despacho de novas issues (modo validation-only ou drain, §16). */
  pauseDispatch(): void {
    this.dispatchPaused = true;
  }

  /** Retoma o despacho de novas issues. */
  resumeDispatch(): void {
    this.dispatchPaused = false;
  }

  isDispatchPaused(): boolean {
    return this.dispatchPaused;
  }

  async dispatch(issue: Issue): Promise<void> {
    if (this.supervisors.has(issue.id)) return;
    if (this.supervisors.size >= this.deps.cfg.concurrentLimit) return;
    const agentId = this.deps.router.route(issue);
    const agent = await this.deps.factory.loadAgent(agentId);
    let workspace: WorkspaceInfo;
    try {
      workspace = this.deps.workspaceManager.create(issue.id);
    } catch (err) {
      if (err instanceof WorktreeCreateFailed) {
        await this.transitionBlocked(issue.id, 'workspace_create_failed', err.message);
        return;
      }
      throw err;
    }
    let prompt: string;
    try {
      prompt = this.deps.promptBuilder.build({ issue, agent, workspace });
    } catch (err) {
      if (err instanceof PromptTooLargeError) {
        await this.transitionBlocked(issue.id, 'prompt_too_large', err.message);
        return;
      }
      throw err;
    }
    const correlationId = newCorrelationId();
    const now = this.deps.clock.now().toISOString();
    this.deps.store.upsertIssue({
      issueId: issue.id,
      trackerType: 'github',
      state: 'in_progress',
      agentId: agent.id,
      workspacePath: workspace.path,
      branchName: workspace.branchName,
      startedAt: now,
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId,
      lastSyncedAt: now,
      blockedReason: null,
    });
    this.deps.store.recordTransition({
      issueId: issue.id,
      fromState: 'ready',
      toState: 'in_progress',
      reason: 'symphony dispatched',
      evidence: null,
      correlationId,
      occurredAt: now,
    });
    await this.deps.tracker.transitionState(issue.id, 'in_progress', 'symphony dispatched');

    // §17: resolve modo de iteração; em loop, prepara o runtime do supervisor.
    let loop: LoopRuntime | undefined;
    if (this.deps.iteration) {
      const resolved = resolveIterationMode(issue, this.deps.iteration);
      if (resolved.mode === 'loop') {
        loop = {
          maxIterations: resolved.maxIterations,
          completionPromise: resolved.completionPromise,
          warningThresholdMs: this.deps.iteration.loopWarningThresholdMs,
        };
        if (resolved.validationCommand) loop.validationCommand = resolved.validationCommand;
        this.deps.log.info({
          event: 'loop_started',
          issue_id: issue.id,
          max_iterations: resolved.maxIterations,
          correlation_id: correlationId,
          message: `Issue ${issue.id} em modo loop (máx ${resolved.maxIterations} iterações)`,
        });
      }
    }

    const sup = new AgentSupervisor({
      issue,
      agent,
      workspace,
      prompt,
      correlationId,
      cli: this.deps.cli,
      tracker: this.deps.tracker,
      store: this.deps.store,
      clock: this.deps.clock,
      log: this.deps.log,
      cfg: this.deps.cfg,
      readHeartbeat: this.deps.readHeartbeat,
      metrics: this.deps.metrics,
      loop,
      onDone: (id) => this.removeSupervisor(id),
    });
    this.supervisors.set(issue.id, sup);
    sup.start();
    this.deps.metrics?.recordDispatch();
    this.dispatchesSinceCheck += 1;
    if (this.deps.harness?.skipCheck) {
      this.deps.log.warn({
        event: 'harness_check_bypassed',
        issue_id: issue.id,
        message: '⚠️  HARNESS CHECK BYPASSED — output quality will likely be poor',
      });
    }
    this.deps.log.info({
      event: 'issue_dispatched',
      issue_id: issue.id,
      agent_id: agent.id,
      correlation_id: correlationId,
      message: `Issue ${issue.id} despachada para ${agent.id}`,
    });
  }

  async reconcile(dryRun: boolean): Promise<unknown[]> {
    return this.deps.reconciler.run({ dryRun });
  }

  async tick(): Promise<void> {
    await this.deps.reconciler.run({ dryRun: false });
    this.maybeRevalidateHarness();
    if (!this.dispatchPaused) {
      const ready = await this.deps.tracker.fetchIssuesByState('ready');
      for (const issue of ready) {
        if (this.supervisors.size >= this.deps.cfg.concurrentLimit) break;
        if (this.supervisors.has(issue.id)) continue;
        await this.dispatch(issue);
      }
    }
    for (const sup of [...this.supervisors.values()]) {
      await sup.tick();
    }
    const done = await this.deps.tracker.fetchIssuesByState('done');
    for (const issue of done) {
      const record = this.deps.store.getIssue(issue.id);
      if (!record || record.state === 'done') continue;
      this.deps.workspaceManager.cleanup(issue.id);
      const now = this.deps.clock.now().toISOString();
      this.deps.store.upsertIssue({
        ...record,
        state: 'done',
        finishedAt: now,
        lastSyncedAt: now,
      });
      this.deps.log.info({
        event: 'workspace_cleaned',
        issue_id: issue.id,
        message: `Workspace removido para issue ${issue.id} (done)`,
      });
    }
  }

  removeSupervisor(issueId: IssueId): void {
    this.supervisors.delete(issueId);
  }

  /**
   * Re-validação periódica de harness (§16.5): a cada N dispatches ou N horas,
   * re-roda o check; se degradou, entra em modo drain (não pega novas issues,
   * deixa as ativas terminarem).
   */
  private maybeRevalidateHarness(): void {
    const h = this.deps.harness;
    if (!h || h.skipCheck || this.dispatchPaused) return;
    const now = this.deps.clock.now().getTime();
    const byDispatch =
      h.revalidateEveryDispatches > 0 && this.dispatchesSinceCheck >= h.revalidateEveryDispatches;
    const byTime = h.revalidateEveryMs > 0 && now - this.lastCheckAtMs >= h.revalidateEveryMs;
    if (!byDispatch && !byTime) return;
    this.dispatchesSinceCheck = 0;
    this.lastCheckAtMs = now;
    const report = h.validator.validate();
    if (report.ready) {
      this.deps.log.info({
        event: 'harness_revalidated',
        message: 'Harness re-validado: repo continua harness-ready',
      });
      return;
    }
    this.dispatchPaused = true;
    this.deps.log.error({
      event: 'harness_degraded',
      failures: report.failures,
      message: `Harness degradou — entrando em modo drain (sem novos dispatches): ${report.failures.join('; ')}`,
    });
  }

  async start(): Promise<void> {
    this.running = true;
    this.lastCheckAtMs = this.deps.clock.now().getTime();
    this.deps.log.info({ event: 'daemon_started', message: 'Symphony daemon iniciado' });
    const loop = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        this.deps.log.error({
          event: 'tick_failed',
          error: err instanceof Error ? err.message : String(err),
          message: 'Erro no tick principal',
        });
      }
      if (this.running) {
        this.timer = this.deps.clock.setTimeout(() => {
          void loop();
        }, this.deps.pollIntervalMs);
      }
    };
    await loop();
  }

  async stop(): Promise<void> {
    this.deps.log.info({
      event: 'daemon_shutting_down',
      message: 'Symphony daemon encerrando',
    });
    this.running = false;
    if (this.timer !== null) {
      this.deps.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    for (const [, sup] of this.supervisors) {
      sup.terminate();
    }
  }

  private async transitionBlocked(
    issueId: IssueId,
    reason: string,
    evidence: string,
  ): Promise<void> {
    const now = this.deps.clock.now().toISOString();
    const existing = this.deps.store.getIssue(issueId);
    this.deps.store.upsertIssue({
      issueId,
      trackerType: 'github',
      state: 'blocked',
      agentId: existing?.agentId ?? null,
      workspacePath: existing?.workspacePath ?? null,
      branchName: existing?.branchName ?? null,
      startedAt: existing?.startedAt ?? null,
      finishedAt: null,
      retryCount: existing?.retryCount ?? 0,
      prNumber: existing?.prNumber ?? null,
      correlationId: existing?.correlationId ?? null,
      lastSyncedAt: now,
      blockedReason: reason,
    });
    this.deps.store.recordTransition({
      issueId,
      fromState: existing?.state ?? 'ready',
      toState: 'blocked',
      reason,
      evidence,
      correlationId: existing?.correlationId ?? newCorrelationId(),
      occurredAt: now,
    });
    await this.deps.tracker.transitionState(issueId, 'blocked', reason);
    this.deps.log.error({
      event: 'agent_blocked',
      issue_id: issueId,
      reason,
      message: `Issue ${issueId} bloqueada: ${reason}`,
    });
  }
}
