import { z } from 'zod';

export const ConfigSchema = z.object({
  tracker: z.object({
    type: z.literal('github'),
    repo: z.string().regex(/^[^/]+\/[^/]+$/, 'tracker.repo deve ser owner/repo'),
    token_env: z.string().min(1),
    poll_interval_ms: z.number().int().positive().default(30_000),
  }),
  cli: z.object({
    type: z.literal('claude-code'),
    binary_path: z.string().min(1),
    permission_mode: z.enum(['plan', 'auto', 'bypass']).default('bypass'),
  }),
  factory: z.object({
    type: z.literal('kairos-forge'),
    installation: z.enum(['plugin', 'local-path']).default('plugin'),
    local_path: z.string().optional(),
  }),
  workspaces: z.object({
    root: z.string().min(1),
    base_branch: z.string().default('main'),
    branch_naming_pattern: z.string().default('symphony/{issue_id}'),
    retention_days: z.number().int().nonnegative().default(7),
    repo_path: z
      .string()
      .min(1, 'workspaces.repo_path obrigatório (path do repo onde rodar git worktree)'),
  }),
  routing: z.object({
    default_agent: z.string().min(1),
    rules: z.array(z.object({ label: z.string(), agent: z.string() })).default([]),
  }),
  limits: z
    .object({
      concurrent_agents: z.number().int().positive().default(5),
      stall_timeout_ms: z.number().int().positive().default(600_000),
      max_retries: z.number().int().nonnegative().default(3),
      retry_backoff_ms: z.array(z.number().int().positive()).default([60_000, 240_000, 960_000]),
      prompt_max_size_bytes: z.number().int().positive().default(1_048_576),
      heartbeat_interval_ms: z.number().int().positive().default(30_000),
      kill_grace_ms: z.number().int().positive().default(5_000),
    })
    .default({} as never),
  storage: z.object({
    type: z.literal('sqlite').default('sqlite'),
    path: z.string().min(1),
  }),
  logging: z
    .object({
      level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      format: z.literal('json').default('json'),
      output: z.string().default('stdout'),
      language: z.enum(['pt-BR', 'en']).default('pt-BR'),
    })
    .default({} as never),
  observability: z
    .object({
      metrics: z
        .object({
          enabled: z.boolean().default(false),
          host: z.string().default('127.0.0.1'),
          listen_port: z.number().int().positive().default(9464),
        })
        .default({} as never),
    })
    .default({} as never),
});

export type SymphonyConfig = z.infer<typeof ConfigSchema>;
