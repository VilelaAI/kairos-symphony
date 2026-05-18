export const ISSUE_STATES = [
  'triage',
  'ready',
  'in_progress',
  'blocked',
  'review_pending',
  'done',
] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

const ALLOWED_TRANSITIONS: Record<IssueState, ReadonlyArray<IssueState>> = {
  triage: ['ready'],
  ready: ['in_progress', 'blocked'],
  in_progress: ['blocked', 'review_pending', 'ready'],
  blocked: ['ready', 'in_progress'],
  review_pending: ['done', 'ready'],
  done: [],
};

export function isAllowedTransition(from: IssueState, to: IssueState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
