import { describe, expect, it, vi } from 'vitest';
import type { Issue } from '../domain/issue.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Logger } from './logger.js';
import { Reconciler, type ReconciliationFinding } from './reconciler.js';

class FakeTracker implements TrackerPort {
  closed = new Set<string>();
  merged = new Set<number>();
  issuesByState = new Map<string, Issue[]>();
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState(state: string) {
    return this.issuesByState.get(state) ?? [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to, reason });
  }
  async detectLinkedPR() {
    return null;
  }
  async isIssueClosed(issueId: string) {
    return this.closed.has(issueId);
  }
  async isPRMerged(n: number) {
    return this.merged.has(n);
  }
}

class FakeStore implements StateStore {
  issues = new Map<string, ReturnType<StateStore['getIssue']>>();
  upsertIssue(r: NonNullable<ReturnType<StateStore['getIssue']>>) {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string) {
    return this.issues.get(id) ?? null;
  }
  listActiveIssues() {
    return [...this.issues.values()].filter((x): x is NonNullable<typeof x> => x !== null);
  }
  listInState(state: string) {
    return this.listActiveIssues().filter((r) => r.state === state);
  }
  recordTransition() {}
  recordDispatch() {
    return 1;
  }
  updateDispatchOutcome() {}
  close() {}
}

const logger = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });

describe('Reconciler — cenário issue closed', () => {
  it('issue fechada externamente → terminar supervisor + cleanup', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    const store = new FakeStore();
    store.upsertIssue({
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
    });

    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T11:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
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

  it('dry-run apenas retorna findings sem chamar terminate/cleanup', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    const store = new FakeStore();
    store.upsertIssue({
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
    });
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date(),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(terminate).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(findings).toHaveLength(1);
  });
});

describe('Reconciler — label transitions', () => {
  it('cenário 3: issue em blocked no DB mas ready no tracker → recordar transição (volta a despachar)', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('ready', [
      {
        id: 'r#1',
        number: 1,
        title: 't',
        body: 'b',
        labels: [],
        state: 'ready',
      },
    ]);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'blocked',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: 'symphony:max-retries-exceeded',
    });
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
    // store deve ter a issue agora como ready, retryCount=0
    expect(store.getIssue('r#1')?.state).toBe('ready');
    expect(store.getIssue('r#1')?.retryCount).toBe(0);
    expect(store.getIssue('r#1')?.blockedReason).toBeNull();
  });
});

describe('Reconciler — PR mergeado externamente', () => {
  it('issue em review_pending cujo PR foi mergeado → done', async () => {
    const tracker = new FakeTracker();
    tracker.merged.add(99);
    const store = new FakeStore();
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'review_pending',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-05-18T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: 99,
      correlationId: 'cid',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: null,
    });
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
});
