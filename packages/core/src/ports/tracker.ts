import type { Issue, IssueId } from '../domain/issue.js';
import type { PullRequestRef } from '../domain/pr.js';
import type { IssueState } from '../domain/states.js';

export interface TrackerPort {
  fetchIssuesByState(state: IssueState): Promise<Issue[]>;
  transitionState(issueId: IssueId, to: IssueState, reason: string): Promise<void>;
  detectLinkedPR(issueId: IssueId): Promise<PullRequestRef | null>;
  isIssueClosed(issueId: IssueId): Promise<boolean>;
  isPRMerged(prNumber: number): Promise<boolean>;
}
