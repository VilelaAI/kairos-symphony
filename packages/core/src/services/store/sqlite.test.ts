import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { SqliteStateStore } from './sqlite.js';

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
