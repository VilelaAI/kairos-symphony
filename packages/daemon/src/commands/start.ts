import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { ObservabilityServer } from '../observability/server.js';
import { buildDaemon } from '../wiring.js';

export const startCommand = defineCommand({
  meta: { name: 'start', description: 'Inicia o daemon (foreground)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const { daemon, store, log, metrics } = buildDaemon(cfg, process.env);

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
