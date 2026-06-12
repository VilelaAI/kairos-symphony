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

  upsertIssue(record: IssueRecord): void {
    this.db
      .prepare(
        `INSERT INTO issues (
           issue_id, tracker_type, state, agent_id, workspace_path, branch_name,
           started_at, finished_at, retry_count, pr_number, correlation_id,
           last_synced_at, blocked_reason
         ) VALUES (
           @issueId, @trackerType, @state, @agentId, @workspacePath, @branchName,
           @startedAt, @finishedAt, @retryCount, @prNumber, @correlationId,
           @lastSyncedAt, @blockedReason
         )
         ON CONFLICT(issue_id) DO UPDATE SET
           tracker_type = excluded.tracker_type,
           state = excluded.state,
           agent_id = excluded.agent_id,
           workspace_path = excluded.workspace_path,
           branch_name = excluded.branch_name,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           retry_count = excluded.retry_count,
           pr_number = excluded.pr_number,
           correlation_id = excluded.correlation_id,
           last_synced_at = excluded.last_synced_at,
           blocked_reason = excluded.blocked_reason`,
      )
      .run(record);
  }

  getIssue(issueId: IssueId): IssueRecord | null {
    const row = this.db.prepare('SELECT * FROM issues WHERE issue_id = ?').get(issueId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRecord(row) : null;
  }
  listActiveIssues(): IssueRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM issues WHERE state != 'done' ORDER BY started_at")
        .all() as Record<string, unknown>[]
    ).map(rowToRecord);
  }

  listInState(state: IssueState): IssueRecord[] {
    return (
      this.db
        .prepare('SELECT * FROM issues WHERE state = ? ORDER BY started_at')
        .all(state) as Record<string, unknown>[]
    ).map(rowToRecord);
  }
  recordTransition(t: Transition): void {
    this.db
      .prepare(
        `INSERT INTO transitions
           (issue_id, from_state, to_state, reason, evidence, correlation_id, occurred_at)
         VALUES (@issueId, @fromState, @toState, @reason, @evidence, @correlationId, @occurredAt)`,
      )
      .run(t);
  }

  recordDispatch(d: Dispatch): number {
    const result = this.db
      .prepare(
        `INSERT INTO dispatches
           (issue_id, agent_id, attempt, started_at, ended_at, exit_code, outcome, correlation_id)
         VALUES (@issueId, @agentId, @attempt, @startedAt, @endedAt, @exitCode, @outcome, @correlationId)`,
      )
      .run(d);
    return Number(result.lastInsertRowid);
  }

  updateDispatchOutcome(
    dispatchId: number,
    outcome: Dispatch['outcome'],
    exitCode: number | null,
    endedAt: string,
  ): void {
    this.db
      .prepare('UPDATE dispatches SET outcome = ?, exit_code = ?, ended_at = ? WHERE id = ?')
      .run(outcome, exitCode, endedAt, dispatchId);
  }

  /** Contagem de issues por estado — fonte do gauge `symphony_issues_in_state` (§13.2). */
  countByState(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT state, COUNT(*) AS n FROM issues GROUP BY state')
      .all() as Array<{ state: string; n: number }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[row.state] = row.n;
    return out;
  }

  /**
   * Histórico de transições (append-only), opcionalmente filtrado por issue —
   * fonte do audit log exportável (§13.2).
   */
  listTransitions(issueId?: IssueId): Transition[] {
    const rows = (
      issueId
        ? this.db
            .prepare('SELECT * FROM transitions WHERE issue_id = ? ORDER BY occurred_at, id')
            .all(issueId)
        : this.db.prepare('SELECT * FROM transitions ORDER BY occurred_at, id').all()
    ) as Record<string, unknown>[];
    return rows.map((row) => ({
      issueId: row.issue_id as string,
      fromState: (row.from_state as Transition['fromState']) ?? null,
      toState: row.to_state as Transition['toState'],
      reason: row.reason as string,
      evidence: (row.evidence as string | null) ?? null,
      correlationId: row.correlation_id as string,
      occurredAt: row.occurred_at as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(row: Record<string, unknown>): IssueRecord {
  return {
    issueId: row.issue_id as string,
    trackerType: row.tracker_type as string,
    state: row.state as IssueRecord['state'],
    agentId: (row.agent_id as string | null) ?? null,
    workspacePath: (row.workspace_path as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    retryCount: row.retry_count as number,
    prNumber: (row.pr_number as number | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    lastSyncedAt: row.last_synced_at as string,
    blockedReason: (row.blocked_reason as string | null) ?? null,
  };
}
