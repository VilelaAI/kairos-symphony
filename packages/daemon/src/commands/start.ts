import { harnessRemediationMessage } from '@kairos-symphony/core';
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { ObservabilityServer } from '../observability/server.js';
import { buildDaemon } from '../wiring.js';

export const startCommand = defineCommand({
  meta: { name: 'start', description: 'Inicia o daemon (foreground)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    'skip-harness-check': {
      type: 'boolean',
      default: false,
      description: '§16.4: força startup em repo não-pronto (modo unsafe)',
    },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    // §16.4: a flag de CLI tem precedência e liga o modo unsafe na config efetiva.
    const skipHarness = cfg.harness.skip_check || args['skip-harness-check'] === true;
    cfg.harness.skip_check = skipHarness;
    const { daemon, store, log, metrics, harnessValidator } = buildDaemon(cfg, process.env);

    // §16.2/§16.3/§16.4: gate de harness-readiness antes de aceitar a 1ª issue.
    if (cfg.harness.enabled) {
      if (skipHarness) {
        log.warn({
          event: 'harness_check_bypassed',
          message: '⚠️  HARNESS CHECK BYPASSED — output quality will likely be poor',
        });
      } else {
        const report = harnessValidator.validate();
        if (report.ready) {
          log.info({ event: 'harness_check_passed', message: 'Repo está harness-ready' });
        } else {
          log.error({
            event: 'harness_check_failed',
            failures: report.failures,
            message: harnessRemediationMessage(report),
          });
          if (cfg.harness.mode_on_failure === 'refuse') {
            store.close();
            process.exit(1);
          }
          // validation_only: sobe o daemon, mas nunca despacha (§16.3).
          daemon.pauseDispatch();
          log.warn({
            event: 'daemon_drained',
            message: 'Modo validation-only: daemon ativo sem despachar (repo não harness-ready)',
          });
        }
      }
    }

    let obsServer: ObservabilityServer | null = null;
    if (cfg.observability.metrics.enabled) {
      obsServer = new ObservabilityServer({
        host: cfg.observability.metrics.host,
        port: cfg.observability.metrics.listen_port,
        registry: metrics,
        log,
      });
      await obsServer.start();
    }

    const shutdown = async (signal: string): Promise<void> => {
      log.info({
        event: 'daemon_shutting_down',
        signal,
        message: `Sinal ${signal} recebido`,
      });
      await daemon.stop();
      await obsServer?.stop();
      store.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    await daemon.start();
  },
});
