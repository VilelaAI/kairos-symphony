import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Logger,
  PathTraversalError,
  PromptBuilder,
  PromptTooLargeError,
  WorkspaceManager,
} from '@kairos-symphony/core';
import { describe, expect, it, vi } from 'vitest';

describe('SPEC §12 — Segurança', () => {
  it('Logger redige tokens / authorization / secret / password / api_key', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink });
    log.info({
      event: 'x',
      message: '',
      token: 'gho_xxx',
      authorization: 'Bearer xxx',
      secret: 'super',
      password: 'p4ss',
      api_key: 'sk-xxx',
    });
    const line = sink.mock.calls[0]?.[0] as string;
    expect(line).not.toContain('gho_xxx');
    expect(line).not.toContain('Bearer xxx');
    expect(line).not.toContain('super');
    expect(line).not.toContain('p4ss');
    expect(line).not.toContain('sk-xxx');
    expect(line).toContain('***');
  });

  it('WorkspaceManager rejeita path traversal (..)', () => {
    const root = mkdtempSync(join(tmpdir(), 's-'));
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      expect(() => wm.resolvePath('../etc/passwd')).toThrow(PathTraversalError);
      expect(() => wm.resolvePath('owner/../../../etc/passwd')).toThrow(PathTraversalError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('PromptBuilder rejeita prompt > 1MB (DoS guard)', () => {
    const pb = new PromptBuilder({ maxBytes: 1_048_576 });
    const issue = {
      id: 'r#1',
      number: 1,
      title: 'T',
      body: 'X'.repeat(2_000_000),
      labels: [],
      state: 'ready' as const,
    };
    const agent = {
      id: 'a',
      name: 'A',
      description: 'D',
      body: 'b',
      filePath: '/x',
    };
    const workspace = {
      issueId: 'r#1',
      path: '/w',
      branchName: 's',
      baseBranch: 'm',
      terminalLogPath: '/w/t',
      heartbeatPath: '/w/h',
    };
    expect(() => pb.build({ issue, agent, workspace })).toThrow(PromptTooLargeError);
  });
});
