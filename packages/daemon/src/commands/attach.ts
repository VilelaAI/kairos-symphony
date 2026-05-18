import { createReadStream, existsSync, statSync, watchFile } from 'node:fs';
import { SqliteStateStore } from '@kairos-symphony/core';
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';

export const attachCommand = defineCommand({
  meta: { name: 'attach', description: 'tail -f no terminal.log do agente da issue' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    issueId: {
      type: 'positional',
      required: true,
      description: 'ID da issue (owner/repo#N)',
    },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const store = new SqliteStateStore({ path: cfg.storage.path });
    const rec = store.getIssue(args.issueId);
    store.close();
    if (!rec || !rec.workspacePath) {
      console.error(`Nenhum workspace ativo para ${args.issueId}`);
      process.exit(1);
    }
    const logPath = `${rec.workspacePath}/.symphony/terminal.log`;
    if (!existsSync(logPath)) {
      console.error(`terminal.log ainda não existe em ${logPath}`);
      process.exit(1);
    }
    let lastSize = 0;
    const readNew = (): void => {
      const size = statSync(logPath).size;
      if (size <= lastSize) return;
      createReadStream(logPath, { start: lastSize, end: size })
        .on('data', (chunk) => process.stdout.write(chunk))
        .on('end', () => {
          lastSize = size;
        });
    };
    readNew();
    watchFile(logPath, { interval: 200 }, readNew);
  },
});
