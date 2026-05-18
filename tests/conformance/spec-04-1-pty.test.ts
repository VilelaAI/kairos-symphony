import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('SPEC §4.1 — Spawn via PTY (não pipes de child_process)', () => {
  it('ClaudeCodeCli usa node-pty e não importa child_process', () => {
    const src = readFileSync(
      resolve(__dirname, '../../packages/cli-claude-code/src/claude-code-cli.ts'),
      'utf8',
    );
    expect(src).toMatch(/node-pty/);
    expect(src).not.toMatch(/from 'node:child_process'/);
    expect(src).not.toMatch(/from "node:child_process"/);
    expect(src).not.toMatch(/require\(['"]node:child_process['"]\)/);
  });
});
