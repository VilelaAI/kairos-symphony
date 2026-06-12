import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { IssueId } from '../domain/issue.js';
import type { WorkspaceInfo } from '../domain/workspace.js';

export class PathTraversalError extends Error {
  constructor(issueId: string) {
    super(`issueId "${issueId}" resolveria fora do workspaces root`);
    this.name = 'PathTraversalError';
  }
}

export class WorktreeCreateFailed extends Error {
  constructor(public readonly stderr: string) {
    super(`git worktree add falhou: ${stderr}`);
    this.name = 'WorktreeCreateFailed';
  }
}

export interface WorkspaceManagerOpts {
  root: string;
  baseBranch: string;
  repoPath: string;
  branchPattern?: string;
}

function safeIssueDirName(issueId: string): string {
  return issueId.replace(/[/#]/g, '-');
}

export class WorkspaceManager {
  constructor(private readonly opts: WorkspaceManagerOpts) {}

  resolvePath(issueId: IssueId): string {
    // Reject any traversal sequences in the raw input before sanitization,
    // since "/" gets replaced by "-" and would otherwise mask "../" patterns.
    if (issueId.includes('..')) {
      throw new PathTraversalError(issueId);
    }
    const safeName = safeIssueDirName(issueId);
    const absRoot = resolve(this.opts.root);
    const candidate = resolve(absRoot, safeName);
    if (!candidate.startsWith(absRoot + sep) && candidate !== absRoot) {
      throw new PathTraversalError(issueId);
    }
    if (candidate === absRoot) {
      throw new PathTraversalError(issueId);
    }
    return candidate;
  }

  create(issueId: IssueId): WorkspaceInfo {
    const path = this.resolvePath(issueId);
    const safeName = safeIssueDirName(issueId);
    const branchName = (this.opts.branchPattern ?? 'symphony/{issue_id}').replace(
      '{issue_id}',
      safeName,
    );
    mkdirSync(dirname(path), { recursive: true });
    const result = spawnSync(
      'git',
      ['worktree', 'add', '-b', branchName, path, this.opts.baseBranch],
      { cwd: this.opts.repoPath, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new WorktreeCreateFailed(result.stderr ?? 'unknown');
    }
    const symphonyDir = resolve(path, '.symphony');
    mkdirSync(symphonyDir, { recursive: true });
    return {
      issueId,
      path,
      branchName,
      baseBranch: this.opts.baseBranch,
      terminalLogPath: resolve(symphonyDir, 'terminal.log'),
      heartbeatPath: resolve(symphonyDir, 'heartbeat'),
    };
  }

  /**
   * Descreve onde um workspace estaria/está em disco sem criá-lo — usado pela
   * reconciliação de "estado interno perdido" (§9.1) para casar issues do
   * tracker com worktrees órfãos e reconstruir o registro.
   */
  describe(issueId: IssueId): { dirName: string; path: string; branchName: string } {
    const path = this.resolvePath(issueId);
    const dirName = safeIssueDirName(issueId);
    const branchName = (this.opts.branchPattern ?? 'symphony/{issue_id}').replace(
      '{issue_id}',
      dirName,
    );
    return { dirName, path, branchName };
  }

  cleanup(issueId: IssueId): void {
    const path = this.resolvePath(issueId);
    if (!existsSync(path)) return;
    spawnSync('git', ['worktree', 'remove', '--force', path], {
      cwd: this.opts.repoPath,
      encoding: 'utf8',
    });
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
    const safeName = safeIssueDirName(issueId);
    const branchName = (this.opts.branchPattern ?? 'symphony/{issue_id}').replace(
      '{issue_id}',
      safeName,
    );
    spawnSync('git', ['branch', '-D', branchName], {
      cwd: this.opts.repoPath,
      encoding: 'utf8',
    });
  }

  listAllOnDisk(): Array<{ issueId: string; path: string }> {
    if (!existsSync(this.opts.root)) return [];
    return readdirSync(this.opts.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ issueId: d.name, path: resolve(this.opts.root, d.name) }));
  }
}
