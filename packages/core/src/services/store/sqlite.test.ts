import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SqliteStateStore } from './sqlite.js';
import type { IssueRecord } from '../../domain/issue.js';
import type { Transition, Dispatch } from '../../domain/transition.js';

describe('SqliteStateStore — migrations', () => {
  let store: SqliteStateStore;

  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
  });

  afterEach(() => {
    store.close();
  });

  it('aplica migration 001 no first open', () => {
    expect(store.schemaVersion()).toBe(1);
  });

  it('é idempotente — segundo open não re-aplica', () => {
    expect(store.schemaVersion()).toBe(1);
    const store2 = new SqliteStateStore({ path: ':memory:' });
    expect(store2.schemaVersion()).toBe(1);
    store2.close();
  });
});

const sample: IssueRecord = {
  issueId: 'r#1',
  trackerType: 'github',
  state: 'in_progress',
  agentId: 'lucas-backend',
  workspacePath: '/tmp/r-1',
  branchName: 'symphony/1',
  startedAt: '2026-05-18T10:00:00.000Z',
  finishedAt: null,
  retryCount: 0,
  prNumber: null,
  correlationId: '11111111-1111-1111-1111-111111111111',
  lastSyncedAt: '2026-05-18T10:00:00.000Z',
  blockedReason: null,
};

describe('SqliteStateStore — issues', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
  });
  afterEach(() => store.close());

  it('insere e busca por issueId', () => {
    store.upsertIssue(sample);
    expect(store.getIssue('r#1')).toEqual(sample);
  });

  it('upsert sobrescreve campos', () => {
    store.upsertIssue(sample);
    store.upsertIssue({ ...sample, state: 'review_pending', prNumber: 99 });
    expect(store.getIssue('r#1')?.state).toBe('review_pending');
    expect(store.getIssue('r#1')?.prNumber).toBe(99);
  });

  it('getIssue retorna null pra id inexistente', () => {
    expect(store.getIssue('r#nope')).toBeNull();
  });
});

describe('SqliteStateStore — list queries', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue({ ...sample, issueId: 'r#1', state: 'in_progress' });
    store.upsertIssue({ ...sample, issueId: 'r#2', state: 'review_pending' });
    store.upsertIssue({ ...sample, issueId: 'r#3', state: 'done' });
    store.upsertIssue({ ...sample, issueId: 'r#4', state: 'blocked' });
  });
  afterEach(() => store.close());

  it('listActiveIssues exclui done', () => {
    const ids = store.listActiveIssues().map((r) => r.issueId).sort();
    expect(ids).toEqual(['r#1', 'r#2', 'r#4']);
  });

  it('listInState filtra por estado', () => {
    expect(store.listInState('review_pending').map((r) => r.issueId)).toEqual(['r#2']);
    expect(store.listInState('done').map((r) => r.issueId)).toEqual(['r#3']);
  });
});

describe('SqliteStateStore — transitions', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue(sample);
  });
  afterEach(() => store.close());

  it('recordTransition é append-only', () => {
    const t: Transition = {
      issueId: 'r#1',
      fromState: 'ready',
      toState: 'in_progress',
      reason: 'symphony dispatched',
      evidence: null,
      correlationId: 'abc',
      occurredAt: '2026-05-18T10:00:00.000Z',
    };
    store.recordTransition(t);
    store.recordTransition({ ...t, fromState: 'in_progress', toState: 'review_pending' });
    const rows = (store as unknown as { db: { prepare: (s: string) => { all: (...a: unknown[]) => unknown[] } } }).db
      .prepare('SELECT * FROM transitions WHERE issue_id = ?')
      .all('r#1') as unknown[];
    expect(rows).toHaveLength(2);
  });
});

describe('SqliteStateStore — dispatches', () => {
  let store: SqliteStateStore;
  beforeEach(() => {
    store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue(sample);
  });
  afterEach(() => store.close());

  it('recordDispatch insere e updateDispatchOutcome atualiza pelo id mais recente', () => {
    const d: Dispatch = {
      issueId: 'r#1',
      agentId: 'lucas-backend',
      attempt: 1,
      startedAt: '2026-05-18T10:00:00.000Z',
      endedAt: null,
      exitCode: null,
      outcome: null,
      correlationId: 'abc',
    };
    const id = store.recordDispatch(d);
    expect(typeof id).toBe('number');
    store.updateDispatchOutcome(id, 'pr_opened', 0, '2026-05-18T10:05:00.000Z');
    const row = (store as unknown as { db: { prepare: (s: string) => { get: (...a: unknown[]) => unknown } } }).db
      .prepare('SELECT outcome, exit_code, ended_at FROM dispatches WHERE id = ?')
      .get(id) as { outcome: string; exit_code: number; ended_at: string };
    expect(row.outcome).toBe('pr_opened');
    expect(row.exit_code).toBe(0);
    expect(row.ended_at).toBe('2026-05-18T10:05:00.000Z');
  });
});
