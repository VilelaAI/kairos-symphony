import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Daemon,
  Logger,
  PromptBuilder,
  Reconciler,
  Router,
  SqliteStateStore,
  WorkspaceManager,
} from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';
import { FakeCli } from '../integration/fakes/fake-cli.js';
import { FakeClock } from '../integration/fakes/fake-clock.js';
import { FakeFactory } from '../integration/fakes/fake-factory.js';
import { FakeTracker } from '../integration/fakes/fake-tracker.js';

describe('SPEC §7 — Detecção de PR via tracker.detectLinkedPR', () => {
  it('PR detectado → transição automática para review_pending', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'c7-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      { cwd: repoPath, shell: '/bin/bash' },
    );
    const root = mkdtempSync(join(tmpdir(), 'c7-ws-'));
    try {
      const tracker = new FakeTracker();
      tracker.issues.set('r#1', {
        id: 'r#1',
        number: 1,
        title: 't',
        body: 'b',
        labels: [],
        state: 'ready',
      });
      const cli = new FakeCli();
      const factory = new FakeFactory();
      factory.agents.set('lucas', {
        id: 'lucas',
        name: 'Lucas',
        description: 'd',
        body: 'b',
        filePath: '/x.md',
      });
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const clock = new FakeClock();
      // biome-ignore lint/style/useConst: forward reference para o reconciler
      let daemon: Daemon;
      const reconciler = new Reconciler({
        tracker,
        store,
        log,
        now: () => clock.now(),
        activeSupervisors: () => daemon.activeSupervisors() as never,
        cleanupWorkspace: (id) => wm.cleanup(id),
        listWorkspacesOnDisk: () => wm.listAllOnDisk(),
      });
      daemon = new Daemon({
        tracker,
        cli,
        factory,
        store,
        log,
        clock,
        workspaceManager: wm,
        router: new Router({ defaultAgent: 'lucas', rules: [] }),
        promptBuilder: new PromptBuilder({ maxBytes: 1_048_576 }),
        reconciler,
        pollIntervalMs: 30_000,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });

      // 1. Tick inicial → despacho (ready → in_progress)
      await daemon.tick();
      expect(store.getIssue('r#1')?.state).toBe('in_progress');

      // 2. Tracker passa a reportar PR vinculado
      tracker.prs.set('r#1', {
        number: 99,
        url: 'https://github.com/x/y/pull/99',
        headBranch: 'symphony/r-1',
        baseBranch: 'main',
        merged: false,
      });

      // 3. Próximo tick → supervisor detecta PR e transiciona para review_pending
      cli.last().emit('progress');
      await daemon.tick();
      expect(tracker.transitions).toContainEqual({
        issueId: 'r#1',
        to: 'review_pending',
        reason: 'PR #99',
      });
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
