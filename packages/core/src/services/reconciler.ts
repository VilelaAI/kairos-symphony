import { newCorrelationId } from '../domain/correlation.js';
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
  | 'internal_state_lost'
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
  /**
   * Mapeia um issueId canônico para onde seu workspace estaria em disco. Quando
   * fornecido, habilita a reconstrução de "estado interno perdido" (§9.1): casa
   * issues ativas do tracker com worktrees órfãos para reconstruir o registro.
   * Ausente → comportamento M1 (órfão é apenas logado).
   */
  describeWorkspace?: (issueId: IssueId) => { dirName: string; path: string; branchName: string };
}

export class Reconciler {
  constructor(private readonly deps: ReconcilerDeps) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<ReconciliationFinding[]> {
    const findings: ReconciliationFinding[] = [];
    await this.scenarioIssueClosed(findings, dryRun);
    await this.scenarioLabelBlockedRemoved(findings, dryRun);
    await this.scenarioPrMergedExternally(findings, dryRun);
    await this.scenarioIssueEdited(findings, dryRun);
    await this.scenarioInternalStateLost(findings, dryRun);
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

  /**
   * Cenário 6: worktree presente em disco sem registro correspondente no DB
   * (daemon crashou, SQLite apagado/corrompido, máquina rebootou).
   *
   * Se `describeWorkspace` está disponível, tentamos **reconstruir** o estado
   * interno a partir do tracker (§9.1, linha "Estado interno perdido"): casamos
   * o diretório órfão com uma issue ativa no tracker (`in_progress` /
   * `review_pending`) e recriamos o `IssueRecord`. Como o processo morreu e a
   * SPEC §9 proíbe restart automático, a issue reconstruída entra em
   * `blocked: symphony:needs-reconciliation` com o workspace preservado, para
   * retomada explícita pelo operador.
   *
   * Sem casamento no tracker (ou sem `describeWorkspace`), mantemos a política
   * conservadora do M1: apenas logar o órfão, sem destruir trabalho.
   */
  private async scenarioInternalStateLost(
    findings: ReconciliationFinding[],
    dryRun: boolean,
  ): Promise<void> {
    const onDisk = this.deps.listWorkspacesOnDisk();
    if (onDisk.length === 0) return;

    const describe = this.deps.describeWorkspace;
    const trackerActive = describe
      ? [
          ...(await this.deps.tracker.fetchIssuesByState('in_progress')),
          ...(await this.deps.tracker.fetchIssuesByState('review_pending')),
        ]
      : [];

    for (const dir of onDisk) {
      const matchingRecord = this.deps.store
        .listActiveIssues()
        .find((r) => r.workspacePath?.endsWith(dir.issueId));
      if (matchingRecord) continue;

      const match = describe
        ? trackerActive.find((issue) => describe(issue.id).dirName === dir.issueId)
        : undefined;

      if (describe && match && !this.deps.store.getIssue(match.id)) {
        const desc = describe(match.id);
        const reason = 'symphony:needs-reconciliation';
        findings.push({
          scenario: 'internal_state_lost',
          issueId: match.id,
          action: 'reconstruct_blocked',
          evidence: { workspaceDir: dir.issueId, path: dir.path, trackerState: match.state },
        });
        this.deps.log.warn({
          event: 'state_reconstructed',
          issue_id: match.id,
          scenario: 'internal_state_lost',
          tracker_state: match.state,
          dry_run: dryRun,
          path: dir.path,
          message: `Estado interno perdido para ${match.id} — reconstruído a partir do tracker; bloqueando para retomada manual (sem restart automático)`,
        });
        if (!dryRun) {
          const now = this.deps.now().toISOString();
          const correlationId = newCorrelationId();
          this.deps.store.upsertIssue({
            issueId: match.id,
            trackerType: 'github',
            state: 'blocked',
            agentId: null,
            workspacePath: desc.path,
            branchName: desc.branchName,
            startedAt: null,
            finishedAt: null,
            retryCount: 0,
            prNumber: null,
            correlationId,
            lastSyncedAt: now,
            blockedReason: reason,
          });
          this.deps.store.recordTransition({
            issueId: match.id,
            fromState: match.state,
            toState: 'blocked',
            reason,
            evidence: JSON.stringify({ reconstructedFrom: dir.path }),
            correlationId,
            occurredAt: now,
          });
          await this.deps.tracker.transitionState(match.id, 'blocked', reason);
        }
        continue;
      }

      findings.push({
        scenario: 'orphan_workspace',
        issueId: null,
        action: 'log_only',
        evidence: { workspaceDir: dir.issueId, path: dir.path },
      });
      this.deps.log.warn({
        event: 'orphan_workspace_detected',
        path: dir.path,
        message: `Workspace órfão em ${dir.path} (sem registro no DB nem issue ativa no tracker) — NÃO restartando automaticamente`,
      });
    }
  }
}
