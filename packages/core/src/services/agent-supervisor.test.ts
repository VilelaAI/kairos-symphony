import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort, SpawnOpts } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { Logger } from './logger.js';
import { AgentSupervisor } from './agent-supervisor.js';

class FakeClock implements Clock {
  private currentMs = new Date('2026-05-18T10:00:00Z').getTime();
  private pending: Array<{ handle: TimerHandle; fireAt: number; fn: () => void }> = [];
  now() {
    return new Date(this.currentMs);
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const handle: TimerHandle = Symbol('t');
    this.pending.push({ handle, fireAt: this.currentMs + ms, fn });
    return handle;
  }
  clearTimeout(h: TimerHandle) {
    this.pending = this.pending.filter((p) => p.handle !== h);
  }
  advance(ms: number) {
    const target = this.currentMs + ms;
    let next = this.pending.filter((p) => p.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    while (next) {
      this.currentMs = next.fireAt;
      this.pending = this.pending.filter((p) => p.handle !== next!.handle);
      next.fn();
      next = this.pending.filter((p) => p.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    }
    this.currentMs = target;
  }
}

class FakeProc implements AgentProcess {
  pid = 1;
  private dataHandlers: Array<(c: string) => void> = [];
  private exitHandlers: Array<(c: number, s: string | null) => void> = [];
  onData(h: (c: string) => void) {
    this.dataHandlers.push(h);
  }
  onExit(h: (c: number, s: string | null) => void) {
    this.exitHandlers.push(h);
  }
  kill() {
    for (const h of this.exitHandlers) h(143, 'SIGTERM');
  }
  emit(chunk: string) {
    for (const h of this.dataHandlers) h(chunk);
  }
  finish(code: number) {
    for (const h of this.exitHandlers) h(code, null);
  }
}

class FakeCli implements CliPort {
  spawned: FakeProc[] = [];
  lastOpts: SpawnOpts | null = null;
  spawn(opts: SpawnOpts) {
    this.lastOpts = opts;
    const p = new FakeProc();
    this.spawned.push(p);
    return p;
  }
  last() {
    return this.spawned[this.spawned.length - 1]!;
  }
}

class FakeTracker implements TrackerPort {
  prByIssue = new Map<string, { number: number; url: string; headBranch: string; baseBranch: string; merged: boolean }>();
  closed = new Set<string>();
  transitions: Array<{ issueId: string; to: string; reason: string }> = [];
  async fetchIssuesByState() {
    return [];
  }
  async transitionState(issueId: string, to: string, reason: string) {
    this.transitions.push({ issueId, to: to as string, reason });
  }
  async detectLinkedPR(issueId: string) {
    return this.prByIssue.get(issueId) ?? null;
  }
  async isIssueClosed(issueId: string) {
    return this.closed.has(issueId);
  }
  async isPRMerged() {
    return false;
  }
}

class FakeStore implements StateStore {
  issues = new Map<string, ReturnType<StateStore['getIssue']>>();
  transitions: unknown[] = [];
  dispatches: unknown[] = [];
  dispatchOutcomes: unknown[] = [];
  upsertIssue(r: NonNullable<ReturnType<StateStore['getIssue']>>) {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string) {
    return this.issues.get(id) ?? null;
  }
  listActiveIssues() {
    return [...this.issues.values()].filter((x): x is NonNullable<typeof x> => x !== null);
  }
  listInState() {
    return [];
  }
  recordTransition(t: unknown) {
    this.transitions.push(t);
  }
  recordDispatch(d: unknown) {
    this.dispatches.push(d);
    return this.dispatches.length;
  }
  updateDispatchOutcome(id: number, outcome: unknown, exitCode: number | null, endedAt: string) {
    this.dispatchOutcomes.push({ id, outcome, exitCode, endedAt });
  }
  close() {}
}

function makeFixtures() {
  const root = mkdtempSync(join(tmpdir(), 'sup-'));
  const wsPath = join(root, 'ws');
  mkdirSync(join(wsPath, '.symphony'), { recursive: true });
  const workspace: WorkspaceInfo = {
    issueId: 'r#1',
    path: wsPath,
    branchName: 'symphony/r-1',
    baseBranch: 'main',
    terminalLogPath: join(wsPath, '.symphony', 'terminal.log'),
  };
  const issue: Issue = {
    id: 'r#1',
    number: 1,
    title: 't',
    body: 'b',
    labels: [],
    state: 'in_progress',
  };
  const agent: AgentDescriptor = {
    id: 'lucas',
    name: 'Lucas',
    description: 'd',
    body: 'b',
    filePath: '/x.md',
  };
  return { workspace, issue, agent, root };
}

describe('AgentSupervisor — start', () => {
  it('spawn do CLI com prompt, cwd e permissionMode da config', () => {
    const cli = new FakeCli();
    const sup = new AgentSupervisor({
      issue: makeFixtures().issue,
      agent: makeFixtures().agent,
      workspace: makeFixtures().workspace,
      prompt: 'PROMPT_AQUI',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock: new FakeClock(),
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/bin/claude',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    expect(cli.lastOpts?.prompt).toBe('PROMPT_AQUI');
    expect(cli.lastOpts?.permissionMode).toBe('bypass');
    expect(cli.lastOpts?.binaryPath).toBe('/bin/claude');
    expect(sup.state).toBe('running');
  });

  it('escreve output do PTY no terminal.log', () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock: new FakeClock(),
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/bin/claude',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    cli.last().emit('hello\n');
    cli.last().emit('world\n');
    expect(readFileSync(f.workspace.terminalLogPath, 'utf8')).toBe('hello\nworld\n');
  });
});

describe('AgentSupervisor — stall', () => {
  it('detecta stall quando não há output por > stallTimeoutMs', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const tracker = new FakeTracker();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker,
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    const killSpy = vi.spyOn(cli.last(), 'kill');
    // Avança 11min sem output
    clock.advance(11 * 60_000);
    await sup.tick();
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(sup.state).toBe('terminating');
  });

  it('não detecta stall se houve output recente', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: {
        permissionMode: 'bypass',
        binaryPath: '/x',
        stallTimeoutMs: 600_000,
        maxRetries: 3,
        backoffMs: [60_000, 240_000, 960_000],
      },
    });
    sup.start();
    clock.advance(5 * 60_000);
    cli.last().emit('progress');
    clock.advance(5 * 60_000);
    const killSpy = vi.spyOn(cli.last(), 'kill');
    await sup.tick();
    expect(killSpy).not.toHaveBeenCalled();
    expect(sup.state).toBe('running');
  });
});
