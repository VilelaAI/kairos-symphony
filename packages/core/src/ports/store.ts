import type { IssueId, IssueRecord } from '../domain/issue.js';
import type { IssueState } from '../domain/states.js';
import type { Dispatch, Transition } from '../domain/transition.js';

export interface StateStore {
  upsertIssue(record: IssueRecord): void;
  getIssue(issueId: IssueId): IssueRecord | null;
  listActiveIssues(): IssueRecord[];
  listInState(state: IssueState): IssueRecord[];
  recordTransition(t: Transition): void;
  recordDispatch(d: Dispatch): number;
  updateDispatchOutcome(
    dispatchId: number,
    outcome: Dispatch['outcome'],
    exitCode: number | null,
    endedAt: string,
  ): void;
  close(): void;
}
