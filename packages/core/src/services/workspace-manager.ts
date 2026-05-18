import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
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

  create(_issueId: IssueId): WorkspaceInfo {
    throw new Error('not implemented');
  }
  cleanup(_issueId: IssueId): void {
    throw new Error('not implemented');
  }
  listAllOnDisk(): Array<{ issueId: string; path: string }> {
    throw new Error('not implemented');
  }
}
