import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { IssueId, IssueRecord } from '../../domain/issue.js';
import type { IssueState } from '../../domain/states.js';
import type { Dispatch, Transition } from '../../domain/transition.js';
import type { StateStore } from '../../ports/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SqliteStateStoreOpts {
  path: string;
}

const MIGRATIONS: ReadonlyArray<{ version: number; file: string }> = [
  { version: 1, file: '001-initial.sql' },
];

export class SqliteStateStore implements StateStore {
  private readonly db: Database.Database;

  constructor(opts: SqliteStateStoreOpts) {
    this.db = new Database(opts.path);
    if (opts.path !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.applyMigrations();
  }

  private applyMigrations(): void {
    const hasMeta = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'")
      .get();
    const currentVersion = hasMeta
      ? (this.db.prepare('SELECT version FROM schema_meta').get() as { version: number }).version
      : 0;
    for (const migration of MIGRATIONS) {
      if (migration.version <= currentVersion) continue;
      const sql = readFileSync(join(__dirname, 'migrations', migration.file), 'utf8');
      this.db.exec(sql);
    }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT version FROM schema_meta').get() as
      | { version: number }
      | undefined;
    return row?.version ?? 0;
  }

  upsertIssue(_record: IssueRecord): void {
    throw new Error('not implemented');
  }
  getIssue(_issueId: IssueId): IssueRecord | null {
    throw new Error('not implemented');
  }
  listActiveIssues(): IssueRecord[] {
    throw new Error('not implemented');
  }
  listInState(_state: IssueState): IssueRecord[] {
    throw new Error('not implemented');
  }
  recordTransition(_t: Transition): void {
    throw new Error('not implemented');
  }
  recordDispatch(_d: Dispatch): number {
    throw new Error('not implemented');
  }
  updateDispatchOutcome(
    _dispatchId: number,
    _outcome: Dispatch['outcome'],
    _exitCode: number | null,
    _endedAt: string,
  ): void {
    throw new Error('not implemented');
  }

  close(): void {
    this.db.close();
  }
}
