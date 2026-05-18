import { describe, expect, it } from 'vitest';
import type { Issue } from '../domain/issue.js';
import { Router } from './router.js';

const baseIssue: Issue = {
  id: 'r#1',
  number: 1,
  title: 't',
  body: 'b',
  labels: [],
  state: 'ready',
};

describe('Router', () => {
  it('label agent:<id> tem precedência máxima', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [{ label: 'bug', agent: 'lucas-backend' }],
    });
    expect(
      router.route({ ...baseIssue, labels: ['bug', 'agent:carlos-dba'] }),
    ).toBe('carlos-dba');
  });

  it('routing.rules por label de tipo se não houver agent:<id>', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [
        { label: 'docs', agent: 'beatriz-docs' },
        { label: 'bug', agent: 'lucas-backend' },
      ],
    });
    expect(router.route({ ...baseIssue, labels: ['bug'] })).toBe('lucas-backend');
    expect(router.route({ ...baseIssue, labels: ['docs'] })).toBe('beatriz-docs');
  });

  it('default agent quando nada casa', () => {
    const router = new Router({ defaultAgent: 'laura-tech-lead', rules: [] });
    expect(router.route(baseIssue)).toBe('laura-tech-lead');
  });

  it('primeiro rule que casar vence (ordem importa)', () => {
    const router = new Router({
      defaultAgent: 'laura-tech-lead',
      rules: [
        { label: 'bug', agent: 'lucas-backend' },
        { label: 'bug', agent: 'outro-cara' },
      ],
    });
    expect(router.route({ ...baseIssue, labels: ['bug'] })).toBe('lucas-backend');
  });
});
