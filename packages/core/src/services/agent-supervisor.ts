import { appendFileSync, writeFileSync } from 'node:fs';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue, IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import type { Logger } from './logger.js';

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
}

export class AgentSupervisor {
  state: SupervisorState = 'idle';
  private proc: AgentProcess | null = null;
  private lastOutputAt = 0;
  private retryCount = 0;
  private dispatchId: number | null = null;
  private retryHandle: TimerHandle | null = null;

  constructor(private readonly deps: SupervisorDeps) {}

  get issueId(): IssueId {
    return this.deps.issue.id;
  }

  start(): void {
    this.state = 'spawning';
    this.retryCount += 1;
    const startedAt = this.deps.clock.now().toISOString();
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
    this.proc = this.deps.cli.spawn({
      binaryPath: this.deps.cfg.binaryPath,
      cwd: this.deps.workspace.path,
      prompt: this.deps.prompt,
      permissionMode: this.deps.cfg.permissionMode,
    });
    this.lastOutputAt = this.deps.clock.now().getTime();
    this.proc.onData((chunk) => {
      appendFileSync(this.deps.workspace.terminalLogPath, chunk);
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

  async tick(): Promise<void> {
    if (this.state !== 'running') return;
    const ageMs = this.deps.clock.now().getTime() - this.lastOutputAt;
    if (ageMs > this.deps.cfg.stallTimeoutMs) {
      this.onStall();
      return;
    }
    const pr = await this.deps.tracker.detectLinkedPR(this.deps.issue.id);
    if (pr) {
      await this.onPRDetected(pr);
    }
  }

  private onStall(): void {
    this.deps.log.warn({
      event: 'agent_stalled',
      issue_id: this.deps.issue.id,
      agent_id: this.deps.agent.id,
      correlation_id: this.deps.correlationId,
      message: `Agente ${this.deps.agent.id} stall detectado para issue ${this.deps.issue.id}`,
    });
    this.state = 'terminating';
    this.proc?.kill('SIGTERM');
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
    this.state = 'done';
    this.deps.onDone?.(this.deps.issue.id);
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
        message: `Agente ${this.deps.agent.id} crashou (exit ${code})`,
      });
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
