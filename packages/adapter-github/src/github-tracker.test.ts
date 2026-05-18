import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GithubTracker } from './github-tracker.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('GithubTracker.fetchIssuesByState', () => {
  it('mapeia ready → busca issues com label symphony:ready', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('labels')).toBe('symphony:ready');
        expect(url.searchParams.get('state')).toBe('open');
        return HttpResponse.json([
          {
            number: 42,
            title: 'Bug X',
            body: 'desc',
            labels: [{ name: 'symphony:ready' }, { name: 'bug' }],
            state: 'open',
            pull_request: undefined,
          },
        ]);
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'gho_x' });
    const issues = await tracker.fetchIssuesByState('ready');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'VilelaAI/test#42',
      number: 42,
      title: 'Bug X',
      labels: ['symphony:ready', 'bug'],
      state: 'ready',
    });
  });

  it('exclui pull requests da listagem de issues', async () => {
    server.use(
      http.get('https://api.github.com/repos/VilelaAI/test/issues', () =>
        HttpResponse.json([
          { number: 1, title: 'i', body: '', labels: [], state: 'open', pull_request: undefined },
          {
            number: 2,
            title: 'pr',
            body: '',
            labels: [],
            state: 'open',
            pull_request: { url: 'x' },
          },
        ]),
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'gho_x' });
    const issues = await tracker.fetchIssuesByState('ready');
    expect(issues.map((i) => i.number)).toEqual([1]);
  });
});

describe('GithubTracker.transitionState', () => {
  it('para in_progress: adiciona label symphony:in-progress e remove symphony:ready', async () => {
    const addCalls: unknown[] = [];
    const removeCalls: string[] = [];
    server.use(
      http.post(
        'https://api.github.com/repos/VilelaAI/test/issues/42/labels',
        async ({ request }) => {
          addCalls.push(await request.json());
          return HttpResponse.json([]);
        },
      ),
      http.delete(
        'https://api.github.com/repos/VilelaAI/test/issues/42/labels/:label',
        ({ params }) => {
          removeCalls.push(params.label as string);
          return HttpResponse.json([]);
        },
      ),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    await tracker.transitionState('VilelaAI/test#42', 'in_progress', 'dispatch');
    expect(addCalls).toEqual([{ labels: ['symphony:in-progress'] }]);
    expect(removeCalls).toContain('symphony:ready');
  });

  it('para done: fecha a issue (não usa label)', async () => {
    let patched: unknown = null;
    server.use(
      http.patch('https://api.github.com/repos/VilelaAI/test/issues/42', async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({});
      }),
    );
    const tracker = new GithubTracker({ owner: 'VilelaAI', repo: 'test', token: 'x' });
    await tracker.transitionState('VilelaAI/test#42', 'done', 'merged');
    expect(patched).toEqual({ state: 'closed' });
  });
});
