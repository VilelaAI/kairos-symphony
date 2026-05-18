import { SqliteStateStore } from '@kairos-symphony/core';
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';

export const psCommand = defineCommand({
  meta: { name: 'ps', description: 'Lista issues ativas (state != done)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const store = new SqliteStateStore({ path: cfg.storage.path });
    const records = store.listActiveIssues();
    const cols = ['ISSUE_ID', 'STATE', 'AGENT', 'STARTED_AT', 'TERMINAL_LOG'];
    const rows = records.map((r) => [
      r.issueId,
      r.state,
      r.agentId ?? '-',
      r.startedAt ?? '-',
      r.workspacePath ? `${r.workspacePath}/.symphony/terminal.log` : '-',
    ]);
    console.log(cols.join('\t'));
    for (const row of rows) console.log(row.join('\t'));
    store.close();
  },
});
