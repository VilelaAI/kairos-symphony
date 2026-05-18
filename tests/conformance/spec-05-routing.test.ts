import { Router } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

describe('SPEC §5 — Routing precedência', () => {
  const router = new Router({
    defaultAgent: 'laura',
    rules: [{ label: 'bug', agent: 'lucas' }],
  });
  const base = { id: 'r#1', number: 1, title: 't', body: 'b', state: 'ready' as const };

  it('label agent:<id> vence rules e default', () => {
    expect(router.route({ ...base, labels: ['bug', 'agent:carlos'] })).toBe('carlos');
  });

  it('rules vence default quando label casa', () => {
    expect(router.route({ ...base, labels: ['bug'] })).toBe('lucas');
  });

  it('default quando nenhuma regra casa', () => {
    expect(router.route({ ...base, labels: [] })).toBe('laura');
    expect(router.route({ ...base, labels: ['outra-coisa'] })).toBe('laura');
  });
});
