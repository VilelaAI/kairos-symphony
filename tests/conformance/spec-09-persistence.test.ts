import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStateStore } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

describe('SPEC §9 — Persistência entre restarts', () => {
  it('grava e relê após close + reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p-'));
    const dbPath = join(dir, 'state.db');
    try {
      let s = new SqliteStateStore({ path: dbPath });
      s.upsertIssue({
        issueId: 'r#1',
        trackerType: 'github',
        state: 'in_progress',
        agentId: 'a',
        workspacePath: '/x',
        branchName: 'symphony/r-1',
        startedAt: '2026-05-18T10:00:00Z',
        finishedAt: null,
        retryCount: 0,
        prNumber: null,
        correlationId: 'cid',
        lastSyncedAt: '2026-05-18T10:00:00Z',
        blockedReason: null,
      });
      s.close();
      s = new SqliteStateStore({ path: dbPath });
      const reread = s.getIssue('r#1');
      expect(reread?.state).toBe('in_progress');
      expect(reread?.agentId).toBe('a');
      expect(reread?.workspacePath).toBe('/x');
      expect(reread?.branchName).toBe('symphony/r-1');
      expect(reread?.correlationId).toBe('cid');
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('schema_meta também persiste (migrations aplicadas só uma vez)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2-'));
    const dbPath = join(dir, 'state.db');
    try {
      let s = new SqliteStateStore({ path: dbPath });
      const v1 = s.schemaVersion();
      s.close();
      s = new SqliteStateStore({ path: dbPath });
      const v2 = s.schemaVersion();
      expect(v1).toBeGreaterThan(0);
      expect(v2).toBe(v1);
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
