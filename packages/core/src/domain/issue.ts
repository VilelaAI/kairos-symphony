import type { IssueState } from './states.js';

export type IssueId = string; // "owner/repo#42"

export interface Issue {
  id: IssueId;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: IssueState;
}

export interface IssueRecord {
  issueId: IssueId;
  trackerType: string;
  state: IssueState;
  agentId: string | null;
  workspacePath: string | null;
  branchName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retryCount: number;
  prNumber: number | null;
  correlationId: string | null;
  lastSyncedAt: string;
  blockedReason: string | null;
}
