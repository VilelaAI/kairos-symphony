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
import { describe, expect, it, vi } from 'vitest';
import { FakeCli } from '../integration/fakes/fake-cli.js';
import { FakeClock } from '../integration/fakes/fake-clock.js';
import { FakeFactory } from '../integration/fakes/fake-factory.js';
import { FakeTracker } from '../integration/fakes/fake-tracker.js';

describe('SPEC §3 — Ordem do loop principal', () => {
  it('reconcile.run é chamado antes de tracker.fetchIssuesByState("ready")', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'c3-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      { cwd: repoPath, shell: '/bin/bash' },
    );
    const root = mkdtempSync(join(tmpdir(), 'c3-ws-'));
    try {
      const tracker = new FakeTracker();
      const cli = new FakeCli();
      const factory = new FakeFactory();
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

      const reconcileSpy = vi.spyOn(reconciler, 'run');
      const fetchSpy = vi.spyOn(tracker, 'fetchIssuesByState');

      await daemon.tick();

      expect(reconcileSpy).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalled();
      const reconcileOrder = reconcileSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
      const firstFetchOrder = fetchSpy.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
      // reconcile precisa começar antes do primeiro fetchIssuesByState
      expect(reconcileOrder).toBeLessThan(firstFetchOrder);
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
