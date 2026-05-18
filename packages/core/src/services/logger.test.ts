import { describe, expect, it, vi } from 'vitest';
import { Logger } from './logger.js';

describe('Logger', () => {
  it('emite linha JSON com campos canônicos', () => {
    const sink = vi.fn();
    const log = new Logger({
      level: 'info',
      write: sink,
      now: () => new Date('2026-05-18T10:00:00Z'),
    });
    log.info({ event: 'issue_dispatched', issue_id: 'r#1', message: 'oi' });
    expect(sink).toHaveBeenCalledOnce();
    const line = sink.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line.trimEnd());
    expect(parsed).toMatchObject({
      timestamp: '2026-05-18T10:00:00.000Z',
      level: 'info',
      event: 'issue_dispatched',
      issue_id: 'r#1',
      message: 'oi',
    });
  });

  it('faz redaction de campos sensíveis', () => {
    const sink = vi.fn();
    const log = new Logger({
      level: 'info',
      write: sink,
      now: () => new Date('2026-05-18T10:00:00Z'),
    });
    log.info({
      event: 'tracker_polled',
      token: 'gho_secret123',
      api_key: 'sk-xxx',
      authorization: 'Bearer abc',
      password: 'p',
      nested: { secret: 'leak' },
      message: 'hello',
    });
    const parsed = JSON.parse((sink.mock.calls[0]?.[0] as string).trimEnd());
    expect(parsed.token).toBe('***');
    expect(parsed.api_key).toBe('***');
    expect(parsed.authorization).toBe('***');
    expect(parsed.password).toBe('***');
    expect(parsed.nested.secret).toBe('***');
  });

  it('respeita nível de log', () => {
    const sink = vi.fn();
    const log = new Logger({ level: 'warn', write: sink, now: () => new Date() });
    log.debug({ event: 'x', message: 'a' });
    log.info({ event: 'x', message: 'b' });
    log.warn({ event: 'x', message: 'c' });
    log.error({ event: 'x', message: 'd' });
    expect(sink).toHaveBeenCalledTimes(2);
  });
});
