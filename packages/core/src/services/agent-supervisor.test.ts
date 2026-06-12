import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentDescriptor } from '../domain/agent.js';
import type { Issue } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';
import type { AgentProcess, CliPort, SpawnOpts } from '../ports/cli.js';
import type { Clock, TimerHandle } from '../ports/clock.js';
import type { StateStore } from '../ports/store.js';
import type { TrackerPort } from '../ports/tracker.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { Logger } from './logger.js';

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
    const pickNext = () =>
      this.pending.filter((p) => p.fireAt <= target).sort((a, b) => a.fireAt - b.fireAt)[0];
    let next = pickNext();
    while (next) {
      const current = next;
      this.currentMs = current.fireAt;
      this.pending = this.pending.filter((p) => p.handle !== current.handle);
      current.fn();
      next = pickNext();
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
  last(): FakeProc {
    const p = this.spawned[this.spawned.length - 1];
    if (!p) throw new Error('Nenhum processo spawned');
    return p;
  }
}

class FakeTracker implements TrackerPort {
  prByIssue = new Map<
    string,
    { number: number; url: string; headBranch: string; baseBranch: string; merged: boolean }
  >();
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
    heartbeatPath: join(wsPath, '.symphony', 'heartbeat'),
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
    // onStall marca terminating; scheduleRetry transiciona para retrying em seguida
    expect(['terminating', 'retrying']).toContain(sup.state);
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

describe('AgentSupervisor — PR detectado', () => {
  it('transiciona para review_pending e chama onDone', async () => {
    const f = makeFixtures();
    const tracker = new FakeTracker();
    tracker.prByIssue.set('r#1', {
      number: 99,
      url: 'https://github.com/r/pull/99',
      headBranch: 'symphony/r-1',
      baseBranch: 'main',
      merged: false,
    });
    const cli = new FakeCli();
    const clock = new FakeClock();
    const onDone = vi.fn();
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
      onDone,
    });
    sup.start();
    await sup.tick();
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'review_pending',
      reason: 'PR #99',
    });
    expect(onDone).toHaveBeenCalledWith('r#1');
    expect(sup.state).toBe('done');
  });
});

describe('AgentSupervisor — exit', () => {
  it('exit code != 0 conta como crash e agenda retry', async () => {
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
    cli.last().finish(127);
    // espera microtasks
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
  });

  it('exit code 0 sem PR detectado também agenda retry', async () => {
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
      tracker: new FakeTracker(), // sem PR
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
    cli.last().finish(0);
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
  });
});

describe('AgentSupervisor — retry/backoff', () => {
  it('agenda retry com backoff [60s, 240s, 960s]', async () => {
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
    cli.last().finish(1); // crash
    await new Promise((r) => setImmediate(r));
    expect(sup.state).toBe('retrying');
    // 59s não dispara; 60s dispara
    clock.advance(59_000);
    expect(cli.spawned.length).toBe(1);
    clock.advance(2_000); // total 61s
    expect(cli.spawned.length).toBe(2);
    expect(sup.state).toBe('running');
  });
});

describe('AgentSupervisor — max retries', () => {
  it('após exceder maxRetries marca blocked e chama tracker.transitionState', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const tracker = new FakeTracker();
    const store = new FakeStore();
    // simula que o Daemon já criou o IssueRecord em in_progress antes de spawnar
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: f.workspace.path,
      branchName: f.workspace.branchName,
      startedAt: clock.now().toISOString(),
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: clock.now().toISOString(),
      blockedReason: null,
    });
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli,
      tracker,
      store,
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
    // Loop: crash → retry 3 vezes; 4ª falha bloqueia
    for (let i = 0; i < 4; i++) {
      cli.last().finish(1);
      await new Promise((r) => setImmediate(r));
      if (i < 3) clock.advance(20 * 60_000); // garante dispara backoff
    }
    expect(sup.state).toBe('blocked');
    expect(tracker.transitions).toContainEqual({
      issueId: 'r#1',
      to: 'blocked',
      reason: 'symphony:max-retries-exceeded',
    });
    // valida que o store também persiste blocked
    expect(store.getIssue('r#1')).toMatchObject({
      state: 'blocked',
      blockedReason: 'symphony:max-retries-exceeded',
    });
    // valida que a transição foi registrada no histórico
    expect(store.transitions).toContainEqual(
      expect.objectContaining({
        issueId: 'r#1',
        toState: 'blocked',
        reason: 'symphony:max-retries-exceeded',
      }),
    );
  });
});

const baseCfg = {
  permissionMode: 'bypass' as const,
  binaryPath: '/x',
  stallTimeoutMs: 600_000,
  maxRetries: 3,
  backoffMs: [60_000, 240_000, 960_000],
};

describe('AgentSupervisor — heartbeat cooperativo (§8.1)', () => {
  it('heartbeat recente mantém o agente vivo mesmo sem output no PTY', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    let heartbeatAt: number | null = null;
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
      cfg: baseCfg,
      readHeartbeat: () => heartbeatAt,
    });
    sup.start();
    // t+5min: agente atualiza o heartbeat (sem nenhum output no PTY)
    clock.advance(5 * 60_000);
    heartbeatAt = clock.now().getTime();
    // t+11min desde o spawn: PTY silencioso há 11min, mas heartbeat há 6min → vivo
    clock.advance(6 * 60_000);
    const killSpy = vi.spyOn(cli.last(), 'kill');
    await sup.tick();
    expect(killSpy).not.toHaveBeenCalled();
    expect(sup.state).toBe('running');
    // heartbeat congela; passa o stallTimeout desde o último heartbeat → stall
    clock.advance(11 * 60_000);
    await sup.tick();
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(['terminating', 'retrying']).toContain(sup.state);
  });
});

describe('AgentSupervisor — spawn do PTY falha (§4.1)', () => {
  it('erro ao spawnar conta como crash e agenda retry, sem derrubar', () => {
    const f = makeFixtures();
    const clock = new FakeClock();
    const throwingCli: CliPort = {
      spawn() {
        throw new Error('pty boom');
      },
    };
    const sup = new AgentSupervisor({
      issue: f.issue,
      agent: f.agent,
      workspace: f.workspace,
      prompt: 'p',
      correlationId: 'cid',
      cli: throwingCli,
      tracker: new FakeTracker(),
      store: new FakeStore(),
      clock,
      log: new Logger({ level: 'error', write: () => undefined, now: () => new Date() }),
      cfg: baseCfg,
    });
    sup.start();
    expect(sup.state).toBe('retrying');
  });
});

describe('AgentSupervisor — escalada SIGTERM→SIGKILL (§4.1)', () => {
  it('processo que ignora SIGTERM recebe SIGKILL após killGraceMs', () => {
    const f = makeFixtures();
    const clock = new FakeClock();
    const signals: Array<string | undefined> = [];
    const stubborn: AgentProcess = {
      pid: 1,
      onData() {},
      onExit() {}, // nunca chama o handler de saída
      kill(sig) {
        signals.push(sig);
      },
    };
    const cli: CliPort = {
      spawn() {
        return stubborn;
      },
    };
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
      cfg: { ...baseCfg, killGraceMs: 5_000 },
    });
    sup.start();
    sup.terminate();
    expect(signals).toContain('SIGTERM');
    expect(signals).not.toContain('SIGKILL');
    clock.advance(5_000);
    expect(signals).toContain('SIGKILL');
  });
});

describe('AgentSupervisor — diagnóstico (§8.2)', () => {
  it('inclui as últimas linhas de output no log de crash', async () => {
    const f = makeFixtures();
    const cli = new FakeCli();
    const clock = new FakeClock();
    const lines: string[] = [];
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
      log: new Logger({ level: 'error', write: (l) => lines.push(l), now: () => new Date() }),
      cfg: baseCfg,
    });
    sup.start();
    cli.last().emit('passo 1 ok\nERRO fatal: boom\n');
    cli.last().finish(1);
    await new Promise((r) => setImmediate(r));
    const crash = lines.map((l) => JSON.parse(l)).find((e) => e.event === 'agent_crashed');
    expect(crash?.last_output).toContain('ERRO fatal: boom');
  });
});
