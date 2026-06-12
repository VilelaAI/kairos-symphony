import { Logger, MetricsRegistry } from '@kairos-symphony/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ObservabilityServer } from './server.js';

describe('ObservabilityServer (§13.2)', () => {
  let server: ObservabilityServer | null = null;
  const host = '127.0.0.1';
  const port = 19473;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('GET /healthz responde 200', async () => {
    const registry = new MetricsRegistry();
    server = new ObservabilityServer({
      host,
      port,
      registry,
      log: new Logger({ level: 'error', write: () => undefined }),
    });
    await server.start();
    const res = await fetch(`http://${host}:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /metrics expõe o registro Prometheus', async () => {
    const registry = new MetricsRegistry({ issuesInState: () => ({ ready: 1 }) });
    registry.recordDispatch();
    server = new ObservabilityServer({
      host,
      port,
      registry,
      log: new Logger({ level: 'error', write: () => undefined }),
    });
    await server.start();
    const res = await fetch(`http://${host}:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('symphony_issues_in_state{state="ready"} 1');
    expect(body).toContain('symphony_dispatches_total 1');
  });

  it('rota desconhecida responde 404', async () => {
    server = new ObservabilityServer({
      host,
      port,
      registry: new MetricsRegistry(),
      log: new Logger({ level: 'error', write: () => undefined }),
    });
    await server.start();
    const res = await fetch(`http://${host}:${port}/nope`);
    expect(res.status).toBe(404);
  });
});
