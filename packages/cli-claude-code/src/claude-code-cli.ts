import type { AgentProcess, CliPort, SpawnOpts } from '@kairos-symphony/core';
import { type IPty, spawn as ptySpawn } from 'node-pty';

const PERMISSION_FLAG: Record<SpawnOpts['permissionMode'], string[]> = {
  plan: ['--permission-mode', 'plan'],
  auto: ['--permission-mode', 'auto'],
  bypass: ['--dangerously-skip-permissions'],
};

export class ClaudeCodeCli implements CliPort {
  spawn(opts: SpawnOpts): AgentProcess {
    const isShellFixture = opts.binaryPath.endsWith('.sh');
    const args = isShellFixture
      ? []
      : [...PERMISSION_FLAG[opts.permissionMode], '--print', opts.prompt];
    const proc: IPty = ptySpawn(opts.binaryPath, args, {
      cwd: opts.cwd,
      cols: opts.ptyCols ?? 120,
      rows: opts.ptyRows ?? 40,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
    // se for shell de fixture, mandar prompt via stdin
    if (isShellFixture) {
      proc.write(`${opts.prompt}\n`);
    }
    let exited = false;
    proc.onExit(() => {
      exited = true;
    });
    return {
      pid: proc.pid,
      onData(h) {
        proc.onData(h);
      },
      onExit(h) {
        proc.onExit(({ exitCode, signal }) =>
          h(exitCode, signal === undefined ? null : String(signal)),
        );
      },
      kill(signal) {
        // §4.1 hardening: kill após o processo já ter saído faz o node-pty
        // lançar (ESRCH); torná-lo idempotente para suportar a escalada
        // SIGTERM→SIGKILL e o shutdown concorrente do daemon.
        if (exited) return;
        try {
          proc.kill(signal ?? 'SIGTERM');
        } catch {
          // processo já morreu entre a checagem e o kill — ignorar.
        }
      },
    };
  }
}
