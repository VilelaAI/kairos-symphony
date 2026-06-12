import { MetricsRegistry, SqliteStateStore } from '@kairos-symphony/core';
import { describe, expect, it } from 'vitest';

// §13.2 — endpoints e métricas. O servidor HTTP (/healthz, /metrics) é exercido
// no teste de unidade do pacote daemon (observability/server.test.ts). Aqui
// validamos o contrato de exposição Prometheus e o audit log exportável.

describe('SPEC §13.2 — métricas Prometheus mínimas', () => {
  it('exposição contém as quatro métricas exigidas com seus tipos', () => {
    const reg = new MetricsRegistry({ issuesInState: () => ({ in_progress: 1 }) });
    reg.recordDispatch();
    reg.recordCrash('lucas');
    reg.observeDispatchDuration(42);
    const out = reg.render();

    expect(out).toMatch(/# TYPE symphony_issues_in_state gauge/);
    expect(out).toMatch(/symphony_issues_in_state\{state="in_progress"\} 1/);

    expect(out).toMatch(/# TYPE symphony_dispatches_total counter/);
    expect(out).toMatch(/symphony_dispatches_total 1/);

    expect(out).toMatch(/# TYPE symphony_crashes_total counter/);
    expect(out).toMatch(/symphony_crashes_total\{agent="lucas"\} 1/);

    expect(out).toMatch(/# TYPE symphony_dispatch_duration_seconds histogram/);
    expect(out).toMatch(/symphony_dispatch_duration_seconds_bucket\{le="\+Inf"\} 1/);
    expect(out).toMatch(/symphony_dispatch_duration_seconds_count 1/);
  });
});

describe('SPEC §13.2 — audit log exportável (transições)', () => {
  it('todas as transições são consultáveis e exportáveis', () => {
    const store = new SqliteStateStore({ path: ':memory:' });
    store.upsertIssue({
      issueId: 'r#1',
      trackerType: 'github',
      state: 'in_progress',
      agentId: 'lucas',
      workspacePath: '/x',
      branchName: 'symphony/r-1',
      startedAt: '2026-06-12T10:00:00.000Z',
      finishedAt: null,
      retryCount: 0,
      prNumber: null,
      correlationId: 'cid',
      lastSyncedAt: '2026-06-12T10:00:00.000Z',
      blockedReason: null,
    });
    store.recordTransition({
      issueId: 'r#1',
      fromState: 'ready',
      toState: 'in_progress',
      reason: 'symphony dispatched',
      evidence: null,
      correlationId: 'cid',
      occurredAt: '2026-06-12T10:00:00.000Z',
    });
    store.recordTransition({
      issueId: 'r#1',
      fromState: 'in_progress',
      toState: 'review_pending',
      reason: 'PR #5',
      evidence: null,
      correlationId: 'cid',
      occurredAt: '2026-06-12T10:30:00.000Z',
    });

    const all = store.listTransitions();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.toState)).toEqual(['in_progress', 'review_pending']);
    store.close();
  });
});
