import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ITERATION_CONFIG,
  Daemon,
  type IterationConfig,
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

const flush = () => new Promise((r) => setImmediate(r));

function setup(labels: string[], iteration: IterationConfig) {
  const repoPath = mkdtempSync(join(tmpdir(), 'c17-'));
  execSync(
    'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
    { cwd: repoPath, shell: '/bin/bash' },
  );
  const root = mkdtempSync(join(tmpdir(), 'c17-ws-'));
  const tracker = new FakeTracker();
  tracker.issues.set('r#1', {
    id: 'r#1',
    number: 1,
    title: 't',
    body: 'b',
    labels,
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
    iteration,
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
  const checkpointOf = () =>
    join(store.getIssue('r#1')?.workspacePath ?? '', '.perseguir', 'checkpoint.md');
  return {
    daemon,
    cli,
    tracker,
    store,
    checkpointOf,
    cleanup: () => {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe('SPEC §17 — Loop autônomo por issue', () => {
  it('§17.2/§17.3/§17.5: label iterate:loop, DONE no checkpoint → review_pending em 1 slot', async () => {
    const { daemon, cli, tracker, store, checkpointOf, cleanup } = setup(
      ['iterate:loop:3'],
      DEFAULT_ITERATION_CONFIG,
    );
    try {
      await daemon.tick(); // despacha em modo loop, iteração 1
      expect(cli.spawned.length).toBe(1);
      expect(daemon.activeSupervisors().size).toBe(1); // §17.5: 1 slot

      writeFileSync(checkpointOf(), 'trabalho concluído\nDONE\n');
      cli.last().finish(0);
      await flush();

      expect(tracker.transitions.some((t) => t.to === 'review_pending')).toBe(true);
      expect(daemon.activeSupervisors().size).toBe(0); // slot liberado ao concluir
      store.close();
    } finally {
      cleanup();
    }
  });

  it('§17.3: esgotar max-iterations → blocked symphony:max-iterations-exceeded', async () => {
    const { daemon, cli, tracker, store, checkpointOf, cleanup } = setup(
      ['iterate:loop:1'],
      DEFAULT_ITERATION_CONFIG,
    );
    try {
      await daemon.tick(); // iteração 1
      writeFileSync(checkpointOf(), 'ainda trabalhando'); // sem DONE
      cli.last().finish(0);
      await flush();
      expect(
        tracker.transitions.some(
          (t) => t.to === 'blocked' && t.reason === 'symphony:max-iterations-exceeded',
        ),
      ).toBe(true);
      store.close();
    } finally {
      cleanup();
    }
  });

  it('default single: issue sem label de loop roda single-shot', async () => {
    const { daemon, cli, store, cleanup } = setup([], DEFAULT_ITERATION_CONFIG);
    try {
      await daemon.tick();
      expect(cli.spawned.length).toBe(1);
      // single-shot: exit 0 sem PR agenda retry (não re-spawna imediatamente como loop)
      cli.last().finish(0);
      await flush();
      expect(store.getIssue('r#1')?.state).toBe('in_progress');
      store.close();
    } finally {
      cleanup();
    }
  });
});
