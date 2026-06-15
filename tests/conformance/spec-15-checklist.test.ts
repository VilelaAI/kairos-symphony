import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SPEC §15 — Checklist de conformidade (M1)', () => {
  const required = [
    'spec-02-states.test.ts',
    'spec-03-main-loop.test.ts',
    'spec-04-workspace.test.ts',
    'spec-04-1-pty.test.ts',
    'spec-05-routing.test.ts',
    'spec-06-prompt.test.ts',
    'spec-07-pr-detection.test.ts',
    'spec-08-stall-crash.test.ts',
    'spec-09-persistence.test.ts',
    'spec-09-1-reconciliation.test.ts',
    'spec-10-config.test.ts',
    'spec-11-logs.test.ts',
    'spec-12-security.test.ts',
    'spec-13-1-terminal-stream.test.ts',
    'spec-13-2-endpoints-metrics.test.ts',
    'spec-16-harness.test.ts',
  ];

  it('todos os arquivos de conformance do M1 existem', () => {
    const present = new Set(readdirSync(__dirname));
    for (const file of required) {
      expect(present.has(file), `Faltou: ${file}`).toBe(true);
    }
  });
});
