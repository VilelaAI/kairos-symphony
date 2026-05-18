import type { IssueId } from './issue.js';
import type { IssueState } from './states.js';

export interface Transition {
  issueId: IssueId;
  fromState: IssueState | null;
  toState: IssueState;
  reason: string;
  evidence: string | null;
  correlationId: string;
  occurredAt: string;
}

export type DispatchOutcome = 'pr_opened' | 'stalled' | 'crashed' | 'exited_no_pr';

export interface Dispatch {
  issueId: IssueId;
  agentId: string;
  attempt: number;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  outcome: DispatchOutcome | null;
  correlationId: string;
}
