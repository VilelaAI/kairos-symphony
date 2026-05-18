import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './loader.js';

const YAML_MIN = `
tracker:
  type: github
  repo: VilelaAI/test
  token_env: GITHUB_TOKEN
cli:
  type: claude-code
  binary_path: /usr/bin/claude
factory:
  type: kairos-forge
workspaces:
  root: /var/symphony/ws
  repo_path: /var/symphony/repo
routing:
  default_agent: laura
storage:
  type: sqlite
  path: /var/symphony/state.db
`;

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const file = join(dir, 'kairos-symphony.config.yaml');
  writeFileSync(file, content);
  return file;
}

describe('loadConfig', () => {
  it('lê YAML e aplica defaults', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({ configPath: file, env: {}, flags: {} });
      expect(cfg.tracker.poll_interval_ms).toBe(30_000);
      expect(cfg.cli.permission_mode).toBe('bypass');
      expect(cfg.limits.concurrent_agents).toBe(5);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('env SYMPHONY_LIMITS_CONCURRENT_AGENTS sobrescreve YAML', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '10' },
        flags: {},
      });
      expect(cfg.limits.concurrent_agents).toBe(10);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('flag --concurrent-agents sobrescreve env', () => {
    const file = tmpFile(YAML_MIN);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '10' },
        flags: { 'concurrent-agents': '20' },
      });
      expect(cfg.limits.concurrent_agents).toBe(20);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('rejeita config inválida com mensagem listando todas as chaves problemáticas', () => {
    const file = tmpFile(`
tracker:
  type: invalid
  repo: invalido
cli:
  type: claude-code
factory:
  type: kairos-forge
workspaces:
  root: ""
routing:
  default_agent: ""
storage:
  type: sqlite
  path: ""
`);
    try {
      expect(() => loadConfig({ configPath: file, env: {}, flags: {} })).toThrow(ConfigError);
    } finally {
      rmSync(file, { force: true });
    }
  });
});
