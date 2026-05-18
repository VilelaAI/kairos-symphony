import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../packages/daemon/src/config/loader.js';

const YAML_BODY = `tracker:
  type: github
  repo: a/b
  token_env: T
cli:
  type: claude-code
  binary_path: /x
factory:
  type: kairos-forge
workspaces:
  root: /r
  repo_path: /rp
routing:
  default_agent: x
storage:
  type: sqlite
  path: /s
limits:
  concurrent_agents: 1
`;

describe('SPEC §10 — Config YAML/env/flags', () => {
  it('precedência: flags > env > YAML (limits.concurrent_agents)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    const file = join(dir, 'c.yaml');
    writeFileSync(file, YAML_BODY);
    try {
      const yamlOnly = loadConfig({ configPath: file, env: {}, flags: {} });
      expect(yamlOnly.limits.concurrent_agents).toBe(1);

      const envOver = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '5' },
        flags: {},
      });
      expect(envOver.limits.concurrent_agents).toBe(5);

      const flagOver = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_CONCURRENT_AGENTS: '5' },
        flags: { 'concurrent-agents': '9' },
      });
      expect(flagOver.limits.concurrent_agents).toBe(9);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies env overrides para tracker.poll_interval_ms e logging.level', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    const file = join(dir, 'c.yaml');
    writeFileSync(file, YAML_BODY);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: {
          SYMPHONY_TRACKER_POLL_INTERVAL_MS: '12345',
          SYMPHONY_LOGGING_LEVEL: 'debug',
        },
        flags: {},
      });
      expect(cfg.tracker.poll_interval_ms).toBe(12345);
      expect(cfg.logging.level).toBe('debug');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags adicionais (stall-timeout-ms, log-level) também sobrepõem env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'c-'));
    const file = join(dir, 'c.yaml');
    writeFileSync(file, YAML_BODY);
    try {
      const cfg = loadConfig({
        configPath: file,
        env: { SYMPHONY_LIMITS_STALL_TIMEOUT_MS: '111', SYMPHONY_LOGGING_LEVEL: 'info' },
        flags: { 'stall-timeout-ms': '222', 'log-level': 'warn' },
      });
      expect(cfg.limits.stall_timeout_ms).toBe(222);
      expect(cfg.logging.level).toBe('warn');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
