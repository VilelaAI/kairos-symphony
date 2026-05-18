import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';
import { buildDaemon } from '../wiring.js';

export const reconcileCommand = defineCommand({
  meta: { name: 'reconcile', description: 'Roda reconciliação uma única vez' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    'dry-run': { type: 'boolean', default: false },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const { daemon, store } = buildDaemon(cfg, process.env);
    const findings = await daemon.reconcile(args['dry-run']);
    console.log(JSON.stringify(findings, null, 2));
    store.close();
  },
});
