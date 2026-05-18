import type {
  Issue,
  IssueId,
  IssueState,
  PullRequestRef,
  TrackerPort,
} from '@kairos-symphony/core';

export class FakeTracker implements TrackerPort {
  issues = new Map<IssueId, Issue>();
  prs = new Map<IssueId, PullRequestRef>();
  mergedPrs = new Set<number>();
  closedIssues = new Set<IssueId>();
  transitions: Array<{ issueId: IssueId; to: IssueState; reason: string }> = [];

  async fetchIssuesByState(state: IssueState): Promise<Issue[]> {
    return [...this.issues.values()].filter((i) => i.state === state);
  }

  async transitionState(issueId: IssueId, to: IssueState, reason: string): Promise<void> {
    this.transitions.push({ issueId, to, reason });
    const issue = this.issues.get(issueId);
    if (issue) this.issues.set(issueId, { ...issue, state: to });
  }

  async detectLinkedPR(issueId: IssueId): Promise<PullRequestRef | null> {
    return this.prs.get(issueId) ?? null;
  }

  async isIssueClosed(issueId: IssueId): Promise<boolean> {
    return this.closedIssues.has(issueId);
  }

  async isPRMerged(prNumber: number): Promise<boolean> {
    return this.mergedPrs.has(prNumber);
  }
}
