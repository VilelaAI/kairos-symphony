import { ISSUE_STATES, isAllowedTransition } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

describe('SPEC §2 — Estados canônicos', () => {
  it('exporta exatamente os 6 estados canônicos', () => {
    expect(new Set(ISSUE_STATES)).toEqual(
      new Set(['triage', 'ready', 'in_progress', 'blocked', 'review_pending', 'done']),
    );
  });

  it('transições válidas conforme diagrama da SPEC', () => {
    expect(isAllowedTransition('triage', 'ready')).toBe(true);
    expect(isAllowedTransition('ready', 'in_progress')).toBe(true);
    expect(isAllowedTransition('in_progress', 'review_pending')).toBe(true);
    expect(isAllowedTransition('review_pending', 'done')).toBe(true);
    expect(isAllowedTransition('ready', 'blocked')).toBe(true);
    expect(isAllowedTransition('in_progress', 'blocked')).toBe(true);
    expect(isAllowedTransition('blocked', 'ready')).toBe(true);
  });

  it('done é estado terminal (sem transições de saída)', () => {
    expect(isAllowedTransition('done', 'ready')).toBe(false);
    expect(isAllowedTransition('done', 'in_progress')).toBe(false);
    expect(isAllowedTransition('done', 'review_pending')).toBe(false);
    expect(isAllowedTransition('done', 'blocked')).toBe(false);
    expect(isAllowedTransition('done', 'triage')).toBe(false);
  });

  it('transições inválidas: pular estados', () => {
    expect(isAllowedTransition('triage', 'in_progress')).toBe(false);
    expect(isAllowedTransition('ready', 'review_pending')).toBe(false);
    expect(isAllowedTransition('ready', 'done')).toBe(false);
  });
});
