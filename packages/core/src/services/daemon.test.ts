import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { AgentProcess, CliPort, SpawnOpts } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { FactoryPort } from '../ports/factory.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Daemon } from './daemon.js';
import { Logger } from './logger.js';
import { PromptBuilder } from './prompt-builder.js';
import { Router } from './router.js';
import { SqliteStateStore } from './store/sqlite.js';
import { WorkspaceManager } from './workspace-manager.js';

class FakeClock implements Clock {
  now() {
    return new Date('2026-05-18T10:00:00Z');
  }
  setTimeout(): TimerHandle {
    return Symbol();
  }
  clearTimeout() {}
}

class FakeCli implements CliPort {
  spawned: SpawnOpts[] = [];
  spawn(opts: SpawnOpts): AgentProcess {
    this.spawned.push(opts);
    return {
      pid: 1,
      onData() {},
      onExit() {},
      kill() {},
    };
  }
}

class FakeTracker implements TrackerPort {
  ready: Issue[] = [];
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState(state: string) {
    return state === 'ready' ? this.ready : [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to, reason });
  }
  async detectLinkedPR() {
    return null;
  }
  async isIssueClosed() {
    return false;
  }
  async isPRMerged() {
    return false;
  }
}

class FakeFactory implements FactoryPort {
  async loadAgent(id: string): Promise<AgentDescriptor> {
    return { id, name: id, description: 'd', body: 'b', filePath: '/x.md' };
  }
  async listAgents() {
    return ['default-agent'];
  }
}

function setupRepo(): { repoPath: string; root: string } {
  const repoPath = mkdtempSync(join(tmpdir(), 'daemon-repo-'));
  execSync('git init -b main', { cwd: repoPath });
  execSync('git config user.email t@t', { cwd: repoPath });
  execSync('git config user.name t', { cwd: repoPath });
  execSync('git commit --allow-empty -m init', { cwd: repoPath });
  const root = mkdtempSync(join(tmpdir(), 'daemon-ws-'));
  return { repoPath, root };
}

describe('Daemon.dispatch', () => {
  it('cria workspace, monta prompt, persiste estado, transiciona tracker, spawna CLI', async () => {
    const { repoPath, root } = setupRepo();
    try {
      const cli = new FakeCli();
      const tracker = new FakeTracker();
      const factory = new FakeFactory();
      const store = new SqliteStateStore({ path: ':memory:' });
      const log = new Logger({ level: 'error', write: () => undefined, now: () => new Date() });
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const router = new Router({ defaultAgent: 'default-agent', rules: [] });
      const pb = new PromptBuilder({ maxBytes: 1_048_576 });
      const daemon = new Daemon({
        tracker,
        cli,
        factory,
        store,
        log,
        clock: new FakeClock(),
        workspaceManager: wm,
        router,
        promptBuilder: pb,
        cfg: {
          concurrentLimit: 5,
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000, 240_000, 960_000],
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
        },
      });
      const issue: Issue = {
        id: 'VilelaAI/repo#42',
        number: 42,
        title: 't',
        body: 'b',
        labels: [],
        state: 'ready',
      };
      await daemon.dispatch(issue);
      expect(cli.spawned).toHaveLength(1);
      expect(cli.spawned[0]?.prompt).toContain('VilelaAI/repo#42');
      expect(tracker.transitions).toContainEqual({
        issueId: 'VilelaAI/repo#42',
        to: 'in_progress',
        reason: 'symphony dispatched',
      });
      const record = store.getIssue('VilelaAI/repo#42');
      expect(record?.state).toBe('in_progress');
      expect(record?.workspacePath).toContain('VilelaAI-repo-42');
      store.close();
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
