import { describe, expect, it } from 'vitest';
import type { Issue } from '../domain/issue.js';
import {
  DEFAULT_ITERATION_CONFIG,
  type IterationConfig,
  parseIterateFrontmatter,
  resolveIterationMode,
} from './iteration.js';

function issue(labels: string[], body = 'corpo'): Issue {
  return { id: 'r#1', number: 1, title: 't', body, labels, state: 'ready' };
}

const cfg: IterationConfig = {
  ...DEFAULT_ITERATION_CONFIG,
  perLabelOverrides: [{ label: 'migration', mode: 'loop', maxIterations: 30 }],
};

describe('resolveIterationMode (§17.2)', () => {
  it('default global é single', () => {
    expect(resolveIterationMode(issue([]), cfg).mode).toBe('single');
  });

  it('per-label override aplica modo loop e max_iterations', () => {
    const r = resolveIterationMode(issue(['migration']), cfg);
    expect(r.mode).toBe('loop');
    expect(r.maxIterations).toBe(30);
  });

  it('label iterate:loop:N tem precedência sobre override e fixa N', () => {
    const r = resolveIterationMode(issue(['migration', 'iterate:loop:7']), cfg);
    expect(r.mode).toBe('loop');
    expect(r.maxIterations).toBe(7);
  });

  it('label iterate:single força single mesmo com override loop', () => {
    expect(resolveIterationMode(issue(['migration', 'iterate:single']), cfg).mode).toBe('single');
  });

  it('frontmatter tem precedência máxima', () => {
    const body = [
      '---',
      'iterate:',
      '  mode: loop',
      '  max_iterations: 25',
      '  completion_promise: "all contract tests pass"',
      '  validation_command: "npm run test:contract"',
      '---',
      '',
      'corpo da issue',
    ].join('\n');
    const r = resolveIterationMode(issue(['iterate:single'], body), cfg);
    expect(r.mode).toBe('loop');
    expect(r.maxIterations).toBe(25);
    expect(r.completionPromise).toBe('all contract tests pass');
    expect(r.validationCommand).toBe('npm run test:contract');
  });
});

describe('parseIterateFrontmatter', () => {
  it('retorna null sem frontmatter', () => {
    expect(parseIterateFrontmatter('só o corpo')).toBeNull();
  });

  it('retorna null com frontmatter sem bloco iterate', () => {
    expect(parseIterateFrontmatter('---\ntitle: x\n---\ncorpo')).toBeNull();
  });

  it('extrai apenas chaves válidas do bloco iterate', () => {
    const fm = parseIterateFrontmatter('---\niterate:\n  mode: loop\n  max_iterations: 5\n---\n');
    expect(fm).toEqual({ mode: 'loop', maxIterations: 5 });
  });
});
