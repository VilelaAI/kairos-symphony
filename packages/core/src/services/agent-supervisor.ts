import { appendFileSync, writeFileSync } from 'node:fs';
import type { AgentDescriptor } from '../domain/agent.js';
import { newCorrelationId } from '../domain/correlation.js';
import type { Issue, IssueId, IssueRecord } from '../domain/issue.js';
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

  // próximas tasks: tick, onProcessExit, onStall, onPRDetected, scheduleRetry
  async tick(): Promise<void> {
    // placeholder
  }
  private async onProcessExit(_code: number): Promise<void> {
    // placeholder
  }
}
