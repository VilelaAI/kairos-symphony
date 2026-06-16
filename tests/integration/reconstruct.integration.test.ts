import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, Reconciler, SqliteStateStore, WorkspaceManager } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';
import { FakeTracker } from './fakes/fake-tracker.js';

describe('integration: reconstrução de estado interno perdido (§9.1)', () => {
  it('worktree real em disco + DB apagado + issue ativa no tracker → reconstrói em blocked, preserva workspace', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'rec-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      { cwd: repoPath, shell: '/bin/bash' },
    );
    const root = mkdtempSync(join(tmpdir(), 'rec-ws-'));
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      // 1ª execução criou o worktree real em disco para a issue r#1…
      const ws = wm.create('r#1');
      expect(existsSync(ws.path)).toBe(true);

      // …mas o daemon morreu e o SQLite foi apagado: store novo, vazio.
      const store = new SqliteStateStore({ path: ':memory:' });
      // O tracker, porém, ainda reflete a issue como in_progress.
      const tracker = new FakeTracker();
      tracker.issues.set('r#1', {
        id: 'r#1',
        number: 1,
        title: 't',
        body: 'b',
        labels: [],
        state: 'in_progress',
      });
      const log = new Logger({ level: 'error', write: () => undefined });
      const reconciler = new Reconciler({
        tracker,
        store,
        log,
        now: () => new Date('2026-05-18T14:00:00Z'),
        activeSupervisors: () => new Map(),
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
        describeWorkspace: (id) => wm.describe(id),
      });

      const findings = await reconciler.run({ dryRun: false });

      expect(findings.some((f) => f.scenario === 'internal_state_lost')).toBe(true);
      const rebuilt = store.getIssue('r#1');
      expect(rebuilt?.state).toBe('blocked');
      expect(rebuilt?.blockedReason).toBe('symphony:needs-reconciliation');
      expect(rebuilt?.workspacePath).toBe(ws.path);
      // Workspace NÃO é destruído — operador retoma manualmente (sem auto-restart §9).
      expect(existsSync(ws.path)).toBe(true);
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
