import { GithubTracker } from '@kairos-symphony/adapter-github';
import { ClaudeCodeCli } from '@kairos-symphony/cli-claude-code';
import {
  Daemon,
  HarnessValidator,
  Logger,
  MetricsRegistry,
  PromptBuilder,
  Reconciler,
  Router,
  SqliteStateStore,
  SystemClock,
  WorkspaceManager,
  defaultHarnessProbe,
} from '@kairos-symphony/core';
import { KairosForgeFactory, discoverForgeAgentsDir } from '@kairos-symphony/factory-kairos-forge';
import type { SymphonyConfig } from './config/schema.js';

export interface WiredDaemon {
  daemon: Daemon;
  store: SqliteStateStore;
  log: Logger;
  metrics: MetricsRegistry;
  harnessValidator: HarnessValidator;
}

export function buildDaemon(
  cfg: SymphonyConfig,
  env: Record<string, string | undefined>,
): WiredDaemon {
  const token = env[cfg.tracker.token_env];
  if (!token) {
    throw new Error(`Variável de ambiente ${cfg.tracker.token_env} não está setada`);
  }
  const [owner, repo] = cfg.tracker.repo.split('/');
  if (!owner || !repo) throw new Error('tracker.repo inválido');

  const tracker = new GithubTracker({ owner, repo, token });
  const cli = new ClaudeCodeCli();
  const agentsDir = cfg.factory.local_path ?? discoverForgeAgentsDir() ?? '';
  if (!agentsDir) {
    throw new Error(
      'Não encontrei agents do kairos-forge — instale o plugin ou configure factory.local_path',
    );
  }
  const factory = new KairosForgeFactory({ agentsDir });
  const store = new SqliteStateStore({ path: cfg.storage.path });
  const log = new Logger({ level: cfg.logging.level });
  const clock = new SystemClock();
  const metrics = new MetricsRegistry({ issuesInState: () => store.countByState() });
  const wm = new WorkspaceManager({
    root: cfg.workspaces.root,
    baseBranch: cfg.workspaces.base_branch,
    repoPath: cfg.workspaces.repo_path,
    branchPattern: cfg.workspaces.branch_naming_pattern,
  });
  const router = new Router({
    defaultAgent: cfg.routing.default_agent,
    rules: cfg.routing.rules,
  });
  const promptBuilder = new PromptBuilder({
    maxBytes: cfg.limits.prompt_max_size_bytes,
    heartbeatIntervalMs: cfg.limits.heartbeat_interval_ms,
  });
  const harnessValidator = new HarnessValidator(defaultHarnessProbe(cfg.workspaces.repo_path));
  // biome-ignore lint/style/useConst: forward reference — daemon precisa existir antes do Reconciler
  let daemon: Daemon;
  const reconciler = new Reconciler({
    tracker,
    store,
    log,
    now: () => clock.now(),
    activeSupervisors: () => daemon.activeSupervisors() as never,
    cleanupWorkspace: (id) => wm.cleanup(id),
    listWorkspacesOnDisk: () => wm.listAllOnDisk(),
    describeWorkspace: (id) => wm.describe(id),
  });
  daemon = new Daemon({
    tracker,
    cli,
    factory,
    store,
    log,
    clock,
    workspaceManager: wm,
    router,
    promptBuilder,
    reconciler,
    metrics,
    iteration: {
      defaultMode: cfg.iteration.default_mode,
      defaultMaxIterations: cfg.iteration.default_max_iterations,
      defaultCompletionPromise: cfg.iteration.default_completion_promise,
      loopWarningThresholdMs: cfg.iteration.loop_warning_threshold_ms,
      perLabelOverrides: cfg.iteration.per_label_overrides.map((o) => ({
        label: o.label,
        mode: o.mode,
        ...(o.max_iterations !== undefined ? { maxIterations: o.max_iterations } : {}),
      })),
    },
    harness: cfg.harness.enabled
      ? {
          validator: harnessValidator,
          skipCheck: cfg.harness.skip_check,
          revalidateEveryDispatches: cfg.harness.revalidate_every_dispatches,
          revalidateEveryMs: Math.round(cfg.harness.revalidate_every_hours * 3_600_000),
        }
      : undefined,
    pollIntervalMs: cfg.tracker.poll_interval_ms,
    cfg: {
      concurrentLimit: cfg.limits.concurrent_agents,
      stallTimeoutMs: cfg.limits.stall_timeout_ms,
      maxRetries: cfg.limits.max_retries,
      backoffMs: cfg.limits.retry_backoff_ms,
      permissionMode: cfg.cli.permission_mode,
      binaryPath: cfg.cli.binary_path,
      killGraceMs: cfg.limits.kill_grace_ms,
      redactEnvKeys: [cfg.tracker.token_env],
    },
  });
  return { daemon, store, log, metrics, harnessValidator };
}
