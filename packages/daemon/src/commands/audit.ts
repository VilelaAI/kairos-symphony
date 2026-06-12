import { SqliteStateStore } from '@kairos-symphony/core';
import { defineCommand } from 'citty';
import { loadConfig } from '../config/loader.js';

/**
 * Audit log exportável (§13.2): despeja o histórico de transições do store.
 * Default em JSON line-delimited (uma transição por linha); `--format csv`
 * para planilha. Opera só sobre o SQLite — sem IPC com o daemon (§1.1).
 */
export const auditCommand = defineCommand({
  meta: { name: 'audit', description: 'Exporta o histórico de transições (audit log)' },
  args: {
    config: { type: 'string', default: 'kairos-symphony.config.yaml' },
    issue: { type: 'string', description: 'Filtra por issue_id', required: false },
    format: { type: 'string', default: 'json', description: 'json | csv' },
  },
  async run({ args }) {
    const cfg = loadConfig({ configPath: args.config, env: process.env, flags: {} });
    const store = new SqliteStateStore({ path: cfg.storage.path });
    const transitions = store.listTransitions(args.issue);

    if (args.format === 'csv') {
      console.log('issue_id,from_state,to_state,reason,correlation_id,occurred_at');
      for (const t of transitions) {
        console.log(
          [
            t.issueId,
            t.fromState ?? '',
            t.toState,
            csvField(t.reason),
            t.correlationId,
            t.occurredAt,
          ].join(','),
        );
      }
    } else {
      for (const t of transitions) console.log(JSON.stringify(t));
    }
    store.close();
  },
});

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
