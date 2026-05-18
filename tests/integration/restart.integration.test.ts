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
import { FakeCli } from './fakes/fake-cli.js';
import { FakeClock } from './fakes/fake-clock.js';
import { FakeFactory } from './fakes/fake-factory.js';
import { FakeTracker } from './fakes/fake-tracker.js';

describe('integration: restart', () => {
  it('reabrir SQLite recupera state; novo daemon NÃO auto-restarta supervisores ativos', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'int-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      {
        cwd: repoPath,
        shell: '/bin/bash',
      },
    );
    const root = mkdtempSync(join(tmpdir(), 'int-ws-'));
    const dbPath = join(tmpdir(), `int-db-${Date.now()}.db`);
    try {
      // 1ª execução: despacha e "morre"
      {
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
        const store = new SqliteStateStore({ path: dbPath });
        const log = new Logger({ level: 'error', write: () => undefined });
        const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
        // biome-ignore lint/style/useConst: forward reference para o reconciler
        let daemon: Daemon;
        const reconciler = new Reconciler({
          tracker,
          store,
          log,
          now: () => new Date(),
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
          clock: new FakeClock(),
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
        await daemon.tick();
        store.close();
      }
      // 2ª execução: novo daemon abre o mesmo DB; tracker AINDA tem issue em ready (humano não viu transição)
      {
        const tracker = new FakeTracker(); // tracker fresco
        // mas o estado no DB diz que r#1 está in_progress
        const cli = new FakeCli();
        const factory = new FakeFactory();
        factory.agents.set('lucas', {
          id: 'lucas',
          name: 'L',
          description: 'd',
          body: 'b',
          filePath: '/x.md',
        });
        const store = new SqliteStateStore({ path: dbPath });
        expect(store.getIssue('r#1')?.state).toBe('in_progress');
        const log = new Logger({ level: 'error', write: () => undefined });
        const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
        // biome-ignore lint/style/useConst: forward reference para o reconciler
        let daemon: Daemon;
        const reconciler = new Reconciler({
          tracker,
          store,
          log,
          now: () => new Date(),
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
          clock: new FakeClock(),
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
        await daemon.tick();
        // CLI deve ter sido spawned 0 vezes (sem ready issue no tracker)
        expect(cli.spawned).toHaveLength(0);
        // E o supervisor in_progress no DB NÃO foi recriado automaticamente
        expect(daemon.activeSupervisors().size).toBe(0);
        store.close();
      }
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
      rmSync(dbPath, { force: true });
    }
  });
});
