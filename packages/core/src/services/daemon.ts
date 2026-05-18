import { newCorrelationId } from '../domain/correlation.js';
import type { Issue, IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { CliPort } from '../ports/cli.js';
import type { Clock } from '../ports/clock.js';
import type { FactoryPort } from '../ports/factory.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { AgentSupervisor, type SupervisorCfg } from './agent-supervisor.js';
import type { Logger } from './logger.js';
import { type PromptBuilder, PromptTooLargeError } from './prompt-builder.js';
import type { Router } from './router.js';
import { type WorkspaceManager, WorktreeCreateFailed } from './workspace-manager.js';

export interface DaemonCfg extends SupervisorCfg {
  concurrentLimit: number;
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
  cfg: DaemonCfg;
}

export class Daemon {
  private readonly supervisors = new Map<IssueId, AgentSupervisor>();

  constructor(private readonly deps: DaemonDeps) {}

  activeSupervisors(): Map<IssueId, AgentSupervisor> {
    return this.supervisors;
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
      onDone: (id) => this.removeSupervisor(id),
    });
    this.supervisors.set(issue.id, sup);
    sup.start();
    this.deps.log.info({
      event: 'issue_dispatched',
      issue_id: issue.id,
      agent_id: agent.id,
      correlation_id: correlationId,
      message: `Issue ${issue.id} despachada para ${agent.id}`,
    });
  }

  async tick(): Promise<void> {
    const ready = await this.deps.tracker.fetchIssuesByState('ready');
    for (const issue of ready) {
      if (this.supervisors.size >= this.deps.cfg.concurrentLimit) break;
      if (this.supervisors.has(issue.id)) continue;
      await this.dispatch(issue);
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
