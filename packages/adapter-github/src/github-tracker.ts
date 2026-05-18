import type {
  Issue,
  IssueId,
  IssueState,
  PullRequestRef,
  TrackerPort,
} from '@kairos-symphony/core';
import { Octokit } from '@octokit/rest';

export interface GithubTrackerOpts {
  owner: string;
  repo: string;
  token: string;
  request?: { fetch?: typeof fetch };
}

const STATE_TO_LABEL: Partial<Record<IssueState, string>> = {
  ready: 'symphony:ready',
  in_progress: 'symphony:in-progress',
  blocked: 'symphony:blocked',
};

const LABEL_TO_STATE: Record<string, IssueState> = {
  'symphony:ready': 'ready',
  'symphony:in-progress': 'in_progress',
  'symphony:blocked': 'blocked',
};

function issueId(owner: string, repo: string, num: number): IssueId {
  return `${owner}/${repo}#${num}`;
}

function inferState(labels: string[], isClosed: boolean): IssueState {
  if (isClosed) return 'done';
  for (const l of labels) {
    if (LABEL_TO_STATE[l]) return LABEL_TO_STATE[l];
  }
  return 'triage';
}

export class GithubTracker implements TrackerPort {
  private readonly oc: Octokit;
  constructor(private readonly opts: GithubTrackerOpts) {
    this.oc = new Octokit({ auth: opts.token, request: opts.request });
  }

  async fetchIssuesByState(state: IssueState): Promise<Issue[]> {
    if (state === 'done') {
      const { data } = await this.oc.issues.listForRepo({
        owner: this.opts.owner,
        repo: this.opts.repo,
        state: 'closed',
        per_page: 100,
      });
      return data
        .filter((r) => !('pull_request' in r) || r.pull_request === undefined)
        .map((r) => ({
          id: issueId(this.opts.owner, this.opts.repo, r.number),
          number: r.number,
          title: r.title,
          body: r.body ?? '',
          labels: r.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
          state: 'done' as IssueState,
        }));
    }
    const label = STATE_TO_LABEL[state];
    if (!label) return [];
    const { data } = await this.oc.issues.listForRepo({
      owner: this.opts.owner,
      repo: this.opts.repo,
      labels: label,
      state: 'open',
      per_page: 100,
    });
    return data
      .filter((r) => !('pull_request' in r) || r.pull_request === undefined)
      .map((r) => {
        const labels = r.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? '')));
        return {
          id: issueId(this.opts.owner, this.opts.repo, r.number),
          number: r.number,
          title: r.title,
          body: r.body ?? '',
          labels,
          state: inferState(labels, false),
        };
      });
  }

  async transitionState(id: IssueId, to: IssueState, _reason: string): Promise<void> {
    const num = Number.parseInt(id.split('#')[1] ?? '0', 10);
    if (to === 'done') {
      await this.oc.issues.update({
        owner: this.opts.owner,
        repo: this.opts.repo,
        issue_number: num,
        state: 'closed',
      });
      return;
    }
    const addLabel = STATE_TO_LABEL[to];
    if (addLabel) {
      await this.oc.issues.addLabels({
        owner: this.opts.owner,
        repo: this.opts.repo,
        issue_number: num,
        labels: [addLabel],
      });
    }
    for (const other of Object.values(STATE_TO_LABEL)) {
      if (other && other !== addLabel) {
        try {
          await this.oc.issues.removeLabel({
            owner: this.opts.owner,
            repo: this.opts.repo,
            issue_number: num,
            name: other,
          });
        } catch (err: unknown) {
          if ((err as { status?: number }).status !== 404) throw err;
        }
      }
    }
  }
  async detectLinkedPR(_issueId: IssueId): Promise<PullRequestRef | null> {
    throw new Error('not implemented');
  }
  async isIssueClosed(_issueId: IssueId): Promise<boolean> {
    throw new Error('not implemented');
  }
  async isPRMerged(_prNumber: number): Promise<boolean> {
    throw new Error('not implemented');
  }
}
