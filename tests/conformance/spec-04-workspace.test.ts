import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

describe('SPEC §4 — Workspace isolation', () => {
  it('cria worktree em path determinístico (owner-repo-N) e branch symphony/<id>', () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'c4-'));
    execSync(
      'git init -b main && git config user.email t@t && git config user.name t && git commit --allow-empty -m init',
      { cwd: repoPath, shell: '/bin/bash' },
    );
    const root = mkdtempSync(join(tmpdir(), 'c4-ws-'));
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('owner/repo#123');
      expect(info.path).toBe(join(root, 'owner-repo-123'));
      expect(info.branchName).toBe('symphony/owner-repo-123');
      expect(info.baseBranch).toBe('main');
      expect(existsSync(info.path)).toBe(true);
      expect(info.terminalLogPath).toBe(join(info.path, '.symphony', 'terminal.log'));
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
