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

describe('Reconciler — issue editada durante execução', () => {
  it('issue ativa cuja descrição mudou no tracker → log apenas, sem ação', async () => {
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
      lastSyncedAt: '2026-05-18T09:00:00.000Z',
      blockedReason: null,
    });
    const terminate = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
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
    // lastSyncedAt atualizado
    expect(store.getIssue('r#1')?.lastSyncedAt).toBe('2026-05-18T12:00:00.000Z');
  });
});

describe('Reconciler — orphan workspaces', () => {
  it('worktree em disco sem registro no DB nem match no tracker → log e NÃO restartar', async () => {
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

const describeWs = (id: string) => ({
  dirName: id.replace(/[/#]/g, '-'),
  path: `/ws/${id.replace(/[/#]/g, '-')}`,
  branchName: `symphony/${id.replace(/[/#]/g, '-')}`,
});

describe('Reconciler — estado interno perdido (§9.1)', () => {
  it('worktree órfão que casa com issue ativa no tracker → reconstrói em blocked (sem restart)', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('in_progress', [
      { id: 'owner/repo#7', number: 7, title: 't', body: 'b', labels: [], state: 'in_progress' },
    ]);
    const store = new FakeStore(); // DB vazio (apagado/corrompido)
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T13:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [{ issueId: 'owner-repo-7', path: '/ws/owner-repo-7' }],
      describeWorkspace: describeWs,
    });
    const findings = await reconciler.run({ dryRun: false });
    expect(findings).toContainEqual<ReconciliationFinding>({
      scenario: 'internal_state_lost',
      issueId: 'owner/repo#7',
      action: 'reconstruct_blocked',
      evidence: {
        workspaceDir: 'owner-repo-7',
        path: '/ws/owner-repo-7',
        trackerState: 'in_progress',
      },
    });
    const rebuilt = store.getIssue('owner/repo#7');
    expect(rebuilt?.state).toBe('blocked');
    expect(rebuilt?.blockedReason).toBe('symphony:needs-reconciliation');
    expect(rebuilt?.workspacePath).toBe('/ws/owner-repo-7');
    expect(rebuilt?.branchName).toBe('symphony/owner-repo-7');
    expect(tracker.transitions).toContainEqual({
      issueId: 'owner/repo#7',
      to: 'blocked',
      reason: 'symphony:needs-reconciliation',
    });
  });

  it('dry-run produz finding sem mutar store nem tracker', async () => {
    const tracker = new FakeTracker();
    tracker.issuesByState.set('review_pending', [
      {
        id: 'owner/repo#7',
        number: 7,
        title: 't',
        body: 'b',
        labels: [],
        state: 'review_pending',
      },
    ]);
    const store = new FakeStore();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T13:00:00Z'),
      activeSupervisors: () => new Map(),
      cleanupWorkspace: () => undefined,
      listWorkspacesOnDisk: () => [{ issueId: 'owner-repo-7', path: '/ws/owner-repo-7' }],
      describeWorkspace: describeWs,
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(findings.some((f) => f.scenario === 'internal_state_lost')).toBe(true);
    expect(store.getIssue('owner/repo#7')).toBeNull();
    expect(tracker.transitions).toHaveLength(0);
  });
});

describe('Reconciler — dry-run integrado', () => {
  it('múltiplos cenários simultâneos em dry-run produzem findings sem efeitos', async () => {
    const tracker = new FakeTracker();
    tracker.closed.add('r#1');
    tracker.merged.add(99);
    tracker.issuesByState.set('ready', [
      { id: 'r#2', number: 2, title: 't', body: 'b', labels: [], state: 'ready' },
    ]);
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
    store.upsertIssue({
      issueId: 'r#2',
      trackerType: 'github',
      state: 'blocked',
      agentId: 'lucas',
      workspacePath: '/y',
      branchName: 'symphony/r-2',
      startedAt: null,
      finishedAt: null,
      retryCount: 3,
      prNumber: null,
      correlationId: 'cid2',
      lastSyncedAt: '2026-05-18T10:00:00.000Z',
      blockedReason: 'symphony:max-retries-exceeded',
    });
    const terminate = vi.fn();
    const cleanup = vi.fn();
    const reconciler = new Reconciler({
      tracker,
      store,
      log: logger,
      now: () => new Date('2026-05-18T12:00:00Z'),
      activeSupervisors: () => new Map([['r#1', { terminate } as { terminate: () => void }]]),
      cleanupWorkspace: cleanup,
      listWorkspacesOnDisk: () => [],
    });
    const findings = await reconciler.run({ dryRun: true });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(terminate).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(tracker.transitions).toHaveLength(0);
    expect(store.getIssue('r#2')?.state).toBe('blocked'); // não mudou
  });
});
