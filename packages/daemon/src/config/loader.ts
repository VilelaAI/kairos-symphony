import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { ConfigSchema, type SymphonyConfig } from './schema.js';

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Config inválida:\n${issues.map((s) => `  - ${s}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const FLAG_TO_PATH: Record<string, string[]> = {
  'concurrent-agents': ['limits', 'concurrent_agents'],
  'poll-interval-ms': ['tracker', 'poll_interval_ms'],
  'stall-timeout-ms': ['limits', 'stall_timeout_ms'],
  'log-level': ['logging', 'level'],
};

function setDeep(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let curr: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] as string;
    if (typeof curr[key] !== 'object' || curr[key] === null) curr[key] = {};
    curr = curr[key] as Record<string, unknown>;
  }
  curr[path[path.length - 1] as string] = value;
}

function coerce(value: string, current: unknown): unknown {
  if (typeof current === 'number') return Number(value);
  if (typeof current === 'boolean') return value === 'true';
  // Sem valor atual no YAML: tenta inferir do shape do próprio string
  if (current === undefined) {
    if (value === 'true' || value === 'false') return value === 'true';
    if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  }
  return value;
}

// Mapeamento explícito de env vars (com underscores ambíguos) → path de chaves no schema.
// Necessário porque chaves snake_case como `concurrent_agents` colidiriam com o split por `_`.
const ENV_TO_PATH: Record<string, string[]> = {
  SYMPHONY_TRACKER_TYPE: ['tracker', 'type'],
  SYMPHONY_TRACKER_REPO: ['tracker', 'repo'],
  SYMPHONY_TRACKER_TOKEN_ENV: ['tracker', 'token_env'],
  SYMPHONY_TRACKER_POLL_INTERVAL_MS: ['tracker', 'poll_interval_ms'],
  SYMPHONY_CLI_TYPE: ['cli', 'type'],
  SYMPHONY_CLI_BINARY_PATH: ['cli', 'binary_path'],
  SYMPHONY_CLI_PERMISSION_MODE: ['cli', 'permission_mode'],
  SYMPHONY_FACTORY_TYPE: ['factory', 'type'],
  SYMPHONY_FACTORY_INSTALLATION: ['factory', 'installation'],
  SYMPHONY_FACTORY_LOCAL_PATH: ['factory', 'local_path'],
  SYMPHONY_WORKSPACES_ROOT: ['workspaces', 'root'],
  SYMPHONY_WORKSPACES_BASE_BRANCH: ['workspaces', 'base_branch'],
  SYMPHONY_WORKSPACES_BRANCH_NAMING_PATTERN: ['workspaces', 'branch_naming_pattern'],
  SYMPHONY_WORKSPACES_RETENTION_DAYS: ['workspaces', 'retention_days'],
  SYMPHONY_WORKSPACES_REPO_PATH: ['workspaces', 'repo_path'],
  SYMPHONY_ROUTING_DEFAULT_AGENT: ['routing', 'default_agent'],
  SYMPHONY_LIMITS_CONCURRENT_AGENTS: ['limits', 'concurrent_agents'],
  SYMPHONY_LIMITS_STALL_TIMEOUT_MS: ['limits', 'stall_timeout_ms'],
  SYMPHONY_LIMITS_MAX_RETRIES: ['limits', 'max_retries'],
  SYMPHONY_LIMITS_PROMPT_MAX_SIZE_BYTES: ['limits', 'prompt_max_size_bytes'],
  SYMPHONY_STORAGE_TYPE: ['storage', 'type'],
  SYMPHONY_STORAGE_PATH: ['storage', 'path'],
  SYMPHONY_LOGGING_LEVEL: ['logging', 'level'],
  SYMPHONY_LOGGING_FORMAT: ['logging', 'format'],
  SYMPHONY_LOGGING_OUTPUT: ['logging', 'output'],
  SYMPHONY_LOGGING_LANGUAGE: ['logging', 'language'],
};

function applyEnvOverrides(
  raw: Record<string, unknown>,
  env: Record<string, string | undefined>,
): void {
  for (const [key, val] of Object.entries(env)) {
    if (!key.startsWith('SYMPHONY_') || val === undefined) continue;
    const path = ENV_TO_PATH[key] ?? key.slice('SYMPHONY_'.length).toLowerCase().split('_');
    let curr: unknown = raw;
    for (const p of path) {
      if (curr && typeof curr === 'object') curr = (curr as Record<string, unknown>)[p];
    }
    setDeep(raw, path, coerce(val, curr));
  }
}

function applyFlagOverrides(raw: Record<string, unknown>, flags: Record<string, string>): void {
  for (const [flag, val] of Object.entries(flags)) {
    const path = FLAG_TO_PATH[flag];
    if (!path) continue;
    let curr: unknown = raw;
    for (const p of path) {
      if (curr && typeof curr === 'object') curr = (curr as Record<string, unknown>)[p];
    }
    setDeep(raw, path, coerce(val, curr));
  }
}

export interface LoadConfigInput {
  configPath: string;
  env: Record<string, string | undefined>;
  flags: Record<string, string>;
}

export function loadConfig(input: LoadConfigInput): SymphonyConfig {
  const yamlText = readFileSync(input.configPath, 'utf8');
  const raw = (parseYaml(yamlText) ?? {}) as Record<string, unknown>;
  applyEnvOverrides(raw, input.env);
  applyFlagOverrides(raw, input.flags);
  try {
    return ConfigSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new ConfigError(issues);
    }
    throw err;
  }
}
