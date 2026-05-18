import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentDescriptor,
  AgentSupervisor,
  type Issue,
  Logger,
  type WorkspaceInfo,
} from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';
import { FakeCli } from '../integration/fakes/fake-cli.js';
import { FakeClock } from '../integration/fakes/fake-clock.js';

// FakeTracker e FakeStore inline (minimalistas para o supervisor)
class StubTracker {
  async fetchIssuesByState() {
    return [];
  }
  async transitionState() {}
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

class StubStore {
  issues = new Map<string, unknown>();
  upsertIssue(r: { issueId: string }) {
    this.issues.set(r.issueId, r);
  }
  getIssue(id: string) {
    return (this.issues.get(id) as never) ?? null;
  }
  listActiveIssues() {
    return [] as never[];
  }
  listInState() {
    return [] as never[];
  }
  recordTransition() {}
  recordDispatch() {
    return 1;
  }
  updateDispatchOutcome() {}
  close() {}
}

describe('SPEC §13.1 — Terminal stream persistido em terminal.log', () => {
  it('AgentSupervisor escreve bytes do PTY (via CliPort.onData) no terminal.log', () => {
    const root = mkdtempSync(join(tmpdir(), 'c131-'));
    try {
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
      const cli = new FakeCli();
      const sup = new AgentSupervisor({
        issue,
        agent,
        workspace,
        prompt: 'p',
        correlationId: 'cid',
        cli,
        tracker: new StubTracker() as never,
        store: new StubStore() as never,
        clock: new FakeClock(),
        log: new Logger({ level: 'error', write: () => undefined }),
        cfg: {
          permissionMode: 'bypass',
          binaryPath: '/usr/bin/true',
          stallTimeoutMs: 600_000,
          maxRetries: 3,
          backoffMs: [60_000, 240_000, 960_000],
        },
      });
      sup.start();
      cli.last().emit('line-1\n');
      cli.last().emit('line-2\n');
      cli.last().emit('multi-byte: 🚀\n');
      const content = readFileSync(workspace.terminalLogPath, 'utf8');
      expect(content).toBe('line-1\nline-2\nmulti-byte: 🚀\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
