export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_PATTERNS = [/token/i, /secret/i, /password/i, /api[_-]?key/i, /authorization/i];

export interface LoggerOpts {
  level: LogLevel;
  write?: (line: string) => void;
  now?: () => Date;
}

export interface LogFields {
  event: string;
  message: string;
  [k: string]: unknown;
}

function shouldRedact(key: string): boolean {
  return REDACT_PATTERNS.some((re) => re.test(key));
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedact(k) ? '***' : redact(v);
  }
  return out;
}

export class Logger {
  private readonly write: (line: string) => void;
  private readonly now: () => Date;
  private readonly level: LogLevel;

  constructor(opts: LoggerOpts) {
    this.level = opts.level;
    this.write = opts.write ?? ((line) => process.stdout.write(line));
    this.now = opts.now ?? (() => new Date());
  }

  private emit(level: LogLevel, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const safe = redact({ ...fields }) as Record<string, unknown>;
    const line = `${JSON.stringify({
      timestamp: this.now().toISOString(),
      level,
      ...safe,
    })}\n`;
    this.write(line);
  }

  debug(f: LogFields): void {
    this.emit('debug', f);
  }
  info(f: LogFields): void {
    this.emit('info', f);
  }
  warn(f: LogFields): void {
    this.emit('warn', f);
  }
  error(f: LogFields): void {
    this.emit('error', f);
  }
}
