import type { IssueId } from '../domain/issue.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import type { Logger } from './logger.js';

export type ReconciliationScenario =
  | 'issue_closed_externally'
  | 'label_ready_removed'
  | 'label_blocked_removed'
  | 'pr_merged_externally'
  | 'issue_edited_during_execution'
  | 'orphan_workspace';

export interface ReconciliationFinding {
  scenario: ReconciliationScenario;
  issueId: IssueId | null;
  action: string;
  evidence?: unknown;
}

export interface ActiveSupervisorRef {
  terminate: () => void;
}

export interface ReconcilerDeps {
  tracker: TrackerPort;
  store: StateStore;
  log: Logger;
  now: () => Date;
  activeSupervisors: () => Map<IssueId, ActiveSupervisorRef>;
  cleanupWorkspace: (issueId: IssueId) => void;
  listWorkspacesOnDisk: () => Array<{ issueId: string; path: string }>;
}

export class Reconciler {
  constructor(private readonly deps: ReconcilerDeps) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    await this.scenarioIssueClosed(findings, dryRun);
    return findings;
  }

  private async scenarioIssueClosed(
    findings: ReconciliationFinding[],
    dryRun: boolean,
  ): Promise<void> {
    const supervisors = this.deps.activeSupervisors();
    for (const [issueId, sup] of supervisors) {
      const closed = await this.deps.tracker.isIssueClosed(issueId);
      if (!closed) continue;
      findings.push({
        scenario: 'issue_closed_externally',
        issueId,
        action: 'terminate_and_cleanup',
      });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issueId,
        scenario: 'issue_closed_externally',
        dry_run: dryRun,
        message: `Issue ${issueId} fechada externamente — encerrando agente`,
      });
      if (!dryRun) {
        sup.terminate();
        this.deps.cleanupWorkspace(issueId);
      }
    }
  }
}
