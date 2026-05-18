import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
