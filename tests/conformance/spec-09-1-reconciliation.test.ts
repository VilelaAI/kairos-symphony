import {
  type Issue,
  type IssueRecord,
  type IssueState,
  Logger,
  type PullRequestRef,
  Reconciler,
  type ReconciliationFinding,
  type StateStore,
  type TrackerPort,
} from '@kairos-symphony/core';
import { describe, expect, it, vi } from 'vitest';

// FakeTracker e FakeStore inline (cópia do unit test, mas adaptado para o contexto de conformance)
class FakeTracker implements TrackerPort {
  closed = new Set<string>();
  merged = new Set<number>();
  issuesByState = new Map<string, Issue[]>();
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState(state: IssueState): Promise<Issue[]> {
    return this.issuesByState.get(state) ?? [];
  }
  async transitionState(issueId: string, to: IssueState, reason: string): Promise<void> {
    this.transitions.push({ issueId, to, reason });
  }
  async detectLinkedPR(): Promise<PullRequestRef | null> {
    return null;
  }
  async isIssueClosed(issueId: string): Promise<boolean> {
    return this.closed.has(issueId);
  }
  async isPRMerged(n: number): Promise<boolean> {
    return this.merged.has(n);
  }
}

class FakeStore implements StateStore {
  issues = new Map<string, IssueRecord>();
  upsertIssue(r: IssueRecord): void {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string): IssueRecord | null {
    return this.issues.get(id) ?? null;
  }
  listActiveIssues(): IssueRecord[] {
    return [...this.issues.values()].filter((r) => r.state !== 'done');
  }
  listInState(state: IssueState): IssueRecord[] {
    return [...this.issues.values()].filter((r) => r.state === state);
  }
  recordTransition(): void {}
  recordDispatch(): number {
    return 1;
  }
  updateDispatchOutcome(): void {}
  close(): void {}
}

const logger = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });

function baseRecord(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    issueId: 'r#1',
    trackerType: 'github',
    state: 'in_progress',
    agentId: 'lucas',
    workspacePath: '/x',
    branchName: 'symphony/r-1',
    startedAt: '2026-05-18T10:00:00.000Z',
    finishedAt: null,
    retryCount: 0,
    prNumber: null,
    correlationId: 'cid',
    lastSyncedAt: '2026-05-18T10:00:00.000Z',
    blockedReason: null,
    ...overrides,
  };
}

describe('SPEC §9.1 — Reconciliação dos 6 cenários', () => {
  it('cenário 1: issue fechada externamente → terminate + cleanup', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    const store = new FakeStore();
    store.upsertIssue(baseRecord());
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T11:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(terminate).toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('r#1');
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'issue_closed_externally',
      issueId: 'r#1',
      action: 'terminate_and_cleanup',
    });
  });

  it('cenário 2: label ready removida — tratado naturalmente pelo Daemon.tick (sem finding aqui)', async () => {
    // SPEC §9.1: o cenário 2 é coberto pelo Daemon ao re-buscar ready imediatamente
    // antes do dispatch — se a label saiu, a issue não aparece. Aqui só validamos
    // que o Reconciler não emite finding falso para issues que não estão no DB.
    const tracker = new FakeTracker();
    const store = new FakeStore();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date(),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toHaveLength(0);
  });

  it('cenário 3: blocked no DB ressurge ready no tracker → reset_to_ready', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('ready', [
      { id: 'r#1', number: 1, title: 't', body: 'b', labels: [], state: 'ready' },
    ]);
    const store = new FakeStore();
    store.upsertIssue(
      baseRecord({
        state: 'blocked',
        retryCount: 3,
        blockedReason: 'symphony:max-retries-exceeded',
      }),
    );
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T11:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'label_blocked_removed',
      issueId: 'r#1',
      action: 'reset_to_ready',
    });
    expect(store.getIssue('r#1')?.state).toBe('ready');
    expect(store.getIssue('r#1')?.retryCount).toBe(0);
    expect(store.getIssue('r#1')?.blockedReason).toBeNull();
  });

  it('cenário 4: PR mergeado externamente → mark_done', async () => {
    const tracker = new FakeTracker();
    tracker.merged.add(99);
    const store = new FakeStore();
    store.upsertIssue(baseRecord({ state: 'review_pending', prNumber: 99 }));
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'pr_merged_externally',
      issueId: 'r#1',
      action: 'mark_done',
    });
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'done',
      reason: 'PR #99 mergeado',
    });
  });

  it('cenário 5: issue editada durante execução → log_only (passivo)', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('in_progress', [
      {
        id: 'r#1',
        number: 1,
        title: 'novo título',
        body: 'novo body',
        labels: ['mudou'],
        state: 'in_progress',
      },
    ]);
    const store = new FakeStore();
    store.upsertIssue(baseRecord({ lastSyncedAt: '2026-05-18T09:00:00.000Z' }));
    const terminate = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate }]]),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(terminate).not.toHaveBeenCalled();
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'issue_edited_during_execution',
      issueId: 'r#1',
      action: 'log_only',
    });
    expect(store.getIssue('r#1')?.lastSyncedAt).toBe('2026-05-18T12:00:00.000Z');
  });

  it('cenário 6: workspace órfão em disco → log_only (sem auto-restart)', async () => {
    const tracker = new FakeTracker();
    const store = new FakeStore();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date(),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [{ issueId: 'r-99', path: '/tmp/r-99' }],
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'orphan_workspace',
      issueId: null,
      action: 'log_only',
      evidence: { workspaceDir: 'r-99', path: '/tmp/r-99' },
    });
  });
});

describe('SPEC §9.1 — dry-run não aplica efeitos', () => {
  it('múltiplos cenários em dry-run: findings reportados, store/tracker intactos', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    tracker.merged.add(99);
    tracker.issuesByState.set('ready', [
      { id: 'r#2', number: 2, title: 't', body: 'b', labels: [], state: 'ready' },
    ]);
    const store = new FakeStore();
    store.upsertIssue(baseRecord());
    store.upsertIssue(
      baseRecord({
        issueId: 'r#2',
        state: 'blocked',
        retryCount: 3,
        blockedReason: 'symphony:max-retries-exceeded',
      }),
    );
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(terminate).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(tracker.transitions).toHaveLength(0);
    expect(store.getIssue('r#2')?.state).toBe('blocked');
  });
});
