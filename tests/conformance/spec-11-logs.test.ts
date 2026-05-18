import { Logger } from '@kairos-symphony/core';
import { describe, expect, it, vi } from 'vitest';

describe('SPEC §11 — Logs estruturados (JSON)', () => {
  it('cada linha é JSON com os campos mínimos', () => {
    const sink = vi.fn();
    const log = new Logger({
      level: 'info',
      write: sink,
      now: () => new Date('2026-05-18T10:00:00Z'),
    });
    log.info({
      event: 'issue_dispatched',
      issue_id: 'r#1',
      agent_id: 'lucas',
      correlation_id: 'cid',
      message: 'Despacho',
    });
    const line = sink.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line.trimEnd());
    for (const key of [
      'timestamp',
      'level',
      'event',
      'issue_id',
      'agent_id',
      'correlation_id',
      'message',
    ]) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('issue_dispatched');
    expect(parsed.issue_id).toBe('r#1');
    expect(parsed.timestamp).toBe('2026-05-18T10:00:00.000Z');
  });

  it('cada linha termina com \\n (linha-orientado)', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink });
    log.info({ event: 'x', message: 'oi' });
    const line = sink.mock.calls[0]?.[0] as string;
    expect(line.endsWith('\n')).toBe(true);
  });

  it('respeita level threshold (debug não emite quando level=info)', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'info', write: sink });
    log.debug({ event: 'x', message: 'oi' });
    expect(sink).not.toHaveBeenCalled();
    log.info({ event: 'x', message: 'oi' });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
