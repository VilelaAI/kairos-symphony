export interface PullRequestRef {
  number: number;
  url: string;
  headBranch: string;
  baseBranch: string;
  merged: boolean;
}
