import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SqliteStateStore } from './sqlite.js';
import type { IssueRecord } from '../../domain/issue.js';

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
