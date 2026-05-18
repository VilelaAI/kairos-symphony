import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeCli } from './claude-code-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(__dirname, 'fixtures', 'fake-cli.sh');

describe('ClaudeCodeCli', () => {
  it('spawn via PTY, recebe data e exit do binário', async () => {
    chmodSync(fakeBin, 0o755);
    const cli = new ClaudeCodeCli();
    const chunks: string[] = [];
    let exitCode = -1;
    await new Promise<void>((resolve) => {
      const proc = cli.spawn({
        binaryPath: fakeBin,
        cwd: __dirname,
        prompt: 'hello',
        permissionMode: 'bypass',
      });
      proc.onData((c) => chunks.push(c));
      proc.onExit((code) => {
        exitCode = code;
        resolve();
      });
    });
    expect(chunks.join('')).toContain('FAKE_CLI got');
    expect(exitCode).toBe(0);
  });
});
