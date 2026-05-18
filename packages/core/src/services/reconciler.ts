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
    await this.scenarioLabelBlockedRemoved(findings, dryRun);
    await this.scenarioPrMergedExternally(findings, dryRun);
    await this.scenarioIssueEdited(findings, dryRun);
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

  /**
   * Cenário 3: issue marcada como blocked no DB voltou para ready no tracker
   * (humano destravou manualmente). Resseta retryCount/blockedReason e volta
   * para a fila — próximo `Daemon.tick()` despachará novamente.
   *
   * Nota: o cenário 2 (label ready removida entre poll e dispatch) é tratado
   * naturalmente pelo `Daemon.tick()`, que faz `fetchIssuesByState("ready")`
   * imediatamente antes do despacho. Se a label foi removida, a issue não
   * aparece na lista — sem necessidade de tratamento explícito aqui.
   */
  private async scenarioLabelBlockedRemoved(
    findings: ReconciliationFinding[],
    dryRun: boolean,
  ): Promise<void> {
    const readyIssues = await this.deps.tracker.fetchIssuesByState('ready');
    for (const issue of readyIssues) {
      const record = this.deps.store.getIssue(issue.id);
      if (!record || record.state !== 'blocked') continue;
      findings.push({
        scenario: 'label_blocked_removed',
        issueId: issue.id,
        action: 'reset_to_ready',
      });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issue.id,
        scenario: 'label_blocked_removed',
        dry_run: dryRun,
        message: `Issue ${issue.id} foi destravada manualmente — voltando para fila`,
      });
      if (!dryRun) {
        this.deps.store.upsertIssue({
          ...record,
          state: 'ready',
          retryCount: 0,
          blockedReason: null,
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }

  /**
   * Cenário 4: issue em review_pending cujo PR foi mergeado externamente
   * (humano fez merge no GitHub). Transição local → done sem rodar agente.
   */
  private async scenarioPrMergedExternally(
    findings: ReconciliationFinding[],
    dryRun: boolean,
  ): Promise<void> {
    const reviewPending = this.deps.store.listInState('review_pending');
    for (const record of reviewPending) {
      if (record.prNumber === null) continue;
      const merged = await this.deps.tracker.isPRMerged(record.prNumber);
      if (!merged) continue;
      findings.push({
        scenario: 'pr_merged_externally',
        issueId: record.issueId,
        action: 'mark_done',
      });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: record.issueId,
        scenario: 'pr_merged_externally',
        pr_number: record.prNumber,
        dry_run: dryRun,
        message: `PR #${record.prNumber} mergeado externamente — marcando done`,
      });
      if (!dryRun) {
        await this.deps.tracker.transitionState(
          record.issueId,
          'done',
          `PR #${record.prNumber} mergeado`,
        );
        this.deps.store.upsertIssue({
          ...record,
          state: 'done',
          finishedAt: this.deps.now().toISOString(),
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }

  /**
   * Cenário 5: issue ativa (com supervisor rodando) cuja descrição/labels
   * mudou no tracker. Passivo: NÃO interrompe o agente; apenas registra
   * o evento e atualiza `lastSyncedAt` para snapshot do novo estado.
   */
  private async scenarioIssueEdited(
    findings: ReconciliationFinding[],
    dryRun: boolean,
  ): Promise<void> {
    const supervisors = this.deps.activeSupervisors();
    if (supervisors.size === 0) return;
    const inProgress = await this.deps.tracker.fetchIssuesByState('in_progress');
    for (const issue of inProgress) {
      if (!supervisors.has(issue.id)) continue;
      const record = this.deps.store.getIssue(issue.id);
      if (!record) continue;
      findings.push({
        scenario: 'issue_edited_during_execution',
        issueId: issue.id,
        action: 'log_only',
      });
      this.deps.log.info({
        event: 'state_reconciled',
        issue_id: issue.id,
        scenario: 'issue_edited_during_execution',
        dry_run: dryRun,
        message: `Issue ${issue.id} sincronizada (sem interromper agente em andamento)`,
      });
      if (!dryRun) {
        this.deps.store.upsertIssue({
          ...record,
          lastSyncedAt: this.deps.now().toISOString(),
        });
      }
    }
  }
}
