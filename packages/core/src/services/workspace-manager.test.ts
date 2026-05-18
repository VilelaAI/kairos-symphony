import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathTraversalError, WorkspaceManager } from './workspace-manager.js';

const makeRoot = () => mkdtempSync(join(tmpdir(), 'symphony-ws-'));

describe('WorkspaceManager — path guard', () => {
  it('rejeita issueId com ../', () => {
    const root = makeRoot();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      expect(() => wm.resolvePath('../etc/passwd')).toThrow(PathTraversalError);
      expect(() => wm.resolvePath('foo/../../etc')).toThrow(PathTraversalError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('aceita issueId normal (substituindo / e # por -)', () => {
    const root = makeRoot();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath: root });
      const p = wm.resolvePath('VilelaAI/repo#42');
      expect(p).toBe(join(root, 'VilelaAI-repo-42'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function setupRepoFixture(): { repoPath: string; root: string } {
  const repoPath = makeRoot();
  execSync('git init -b main', { cwd: repoPath });
  execSync('git config user.email "t@t" && git config user.name "t"', { cwd: repoPath, shell: '/bin/bash' });
  execSync('git commit --allow-empty -m "init"', { cwd: repoPath });
  const root = makeRoot();
  return { repoPath, root };
}

describe('WorkspaceManager — create/cleanup', () => {
  it('cria worktree em branch symphony/<sanitizedId>', () => {
    const { repoPath, root } = setupRepoFixture();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('VilelaAI/repo#42');
      expect(info.path).toBe(join(root, 'VilelaAI-repo-42'));
      expect(info.branchName).toBe('symphony/VilelaAI-repo-42');
      expect(info.baseBranch).toBe('main');
      expect(existsSync(info.path)).toBe(true);
      expect(existsSync(info.terminalLogPath)).toBe(false);
      expect(existsSync(join(info.path, '.symphony'))).toBe(true);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleanup remove worktree + branch', () => {
    const { repoPath, root } = setupRepoFixture();
    try {
      const wm = new WorkspaceManager({ root, baseBranch: 'main', repoPath });
      const info = wm.create('r#1');
      expect(existsSync(info.path)).toBe(true);
      wm.cleanup('r#1');
      expect(existsSync(info.path)).toBe(false);
    } finally {
      rmSync(repoPath, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
