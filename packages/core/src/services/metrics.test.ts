import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics.js';

describe('MetricsRegistry', () => {
  it('renderiza gauge de issues por estado a partir do provider', () => {
    const reg = new MetricsRegistry({
      issuesInState: () => ({ ready: 2, in_progress: 1, done: 5 }),
    });
    const out = reg.render();
    expect(out).toContain('# TYPE symphony_issues_in_state gauge');
    expect(out).toContain('symphony_issues_in_state{state="ready"} 2');
    expect(out).toContain('symphony_issues_in_state{state="in_progress"} 1');
    expect(out).toContain('symphony_issues_in_state{state="done"} 5');
    // estados sem contagem aparecem como 0
    expect(out).toContain('symphony_issues_in_state{state="triage"} 0');
  });

  it('conta dispatches e crashes por agente', () => {
    const reg = new MetricsRegistry();
    reg.recordDispatch();
    reg.recordDispatch();
    reg.recordCrash('lucas');
    reg.recordCrash('lucas');
    reg.recordCrash('beatriz');
    const out = reg.render();
    expect(out).toContain('symphony_dispatches_total 2');
    expect(out).toContain('symphony_crashes_total{agent="lucas"} 2');
    expect(out).toContain('symphony_crashes_total{agent="beatriz"} 1');
  });

  it('histograma de duração: buckets cumulativos, sum e count', () => {
    const reg = new MetricsRegistry();
    reg.observeDispatchDuration(45); // cai em le=60 e acima
    reg.observeDispatchDuration(500); // cai em le=600 e acima
    const out = reg.render();
    expect(out).toContain('# TYPE symphony_dispatch_duration_seconds histogram');
    expect(out).toContain('symphony_dispatch_duration_seconds_bucket{le="30"} 0');
    expect(out).toContain('symphony_dispatch_duration_seconds_bucket{le="60"} 1');
    expect(out).toContain('symphony_dispatch_duration_seconds_bucket{le="600"} 2');
    expect(out).toContain('symphony_dispatch_duration_seconds_bucket{le="+Inf"} 2');
    expect(out).toContain('symphony_dispatch_duration_seconds_sum 545');
    expect(out).toContain('symphony_dispatch_duration_seconds_count 2');
  });

  it('saída termina com newline e tem HELP/TYPE para cada métrica obrigatória', () => {
    const reg = new MetricsRegistry();
    const out = reg.render();
    expect(out.endsWith('\n')).toBe(true);
    for (const name of [
      'symphony_issues_in_state',
      'symphony_dispatches_total',
      'symphony_crashes_total',
      'symphony_dispatch_duration_seconds',
    ]) {
      expect(out).toContain(`# TYPE ${name}`);
    }
  });
});
