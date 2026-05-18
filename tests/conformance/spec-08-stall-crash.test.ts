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

describe('SPEC §8 — Stall/crash + retry com backoff exponencial', () => {
  it('stall repetido → backoff escalonado → max-retries → blocked', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'c8-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      { cwd: repoPath, shell: '/bin/bash' },
    );
    const root = mkdtempSync(join(tmpdir(), 'c8-ws-'));
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
        name: 'L',
        description: 'd',
        body: 'b',
        filePath: '/x.md',
      });
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const clock = new FakeClock();
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
          maxRetries: 2,
          backoffMs: [60_000, 240_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      await daemon.tick();
      expect(store.getIssue('r#1')?.state).toBe('in_progress');

      // Cicla: stall (>10min sem output), backoff, stall, backoff, stall (excede max-retries)
      for (let i = 0; i < 3; i++) {
        clock.advance(11 * 60_000); // expira stallTimeout
        await daemon.tick();
        clock.advance(20 * 60_000); // dispara backoff scheduled
      }

      expect(store.getIssue('r#1')?.state).toBe('blocked');
      expect(store.getIssue('r#1')?.blockedReason).toBe('symphony:max-retries-exceeded');
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
