import {
  type AgentProcess,
  type CliPort,
  type SpawnOpts,
  sanitizeAgentEnv,
} from '@kairos-symphony/core';
import { type IPty, spawn as ptySpawn } from 'node-pty';

const PERMISSION_FLAG: Record<SpawnOpts['permissionMode'], string[]> = {
  plan: ['--permission-mode', 'plan'],
  auto: ['--permission-mode', 'auto'],
  bypass: ['--dangerously-skip-permissions'],
};

/**
 * Credenciais que o próprio Claude Code precisa para autenticar no modelo — o
 * sandbox de env (§12) preserva estas, mas remove o token do tracker e demais
 * segredos do daemon.
 */
const CLAUDE_ENV_ALLOW = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

export class ClaudeCodeCli implements CliPort {
  spawn(opts: SpawnOpts): AgentProcess {
    const isShellFixture = opts.binaryPath.endsWith('.sh');
    const args = isShellFixture
      ? []
      : [...PERMISSION_FLAG[opts.permissionMode], '--print', opts.prompt];
    // §12: o agente nunca herda o token do tracker nem segredos do daemon, mas
    // mantém as credenciais que o próprio CLI precisa para falar com o modelo.
    const env = {
      ...sanitizeAgentEnv(process.env, {
        denyKeys: opts.redactEnvKeys ?? [],
        allowKeys: CLAUDE_ENV_ALLOW,
      }),
      ...opts.env,
    };
    const proc: IPty = ptySpawn(opts.binaryPath, args, {
      cwd: opts.cwd,
      cols: opts.ptyCols ?? 120,
      rows: opts.ptyRows ?? 40,
      env,
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
