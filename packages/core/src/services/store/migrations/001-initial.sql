CREATE TABLE issues (
  issue_id          TEXT PRIMARY KEY,
  tracker_type      TEXT NOT NULL,
  state             TEXT NOT NULL,
  agent_id          TEXT,
  workspace_path    TEXT,
  branch_name       TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  pr_number         INTEGER,
  correlation_id    TEXT,
  last_synced_at    TEXT NOT NULL,
  blocked_reason    TEXT
);
CREATE INDEX idx_issues_state ON issues(state);

CREATE TABLE transitions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id          TEXT NOT NULL,
  from_state        TEXT,
  to_state          TEXT NOT NULL,
  reason            TEXT NOT NULL,
  evidence          TEXT,
  correlation_id    TEXT NOT NULL,
  occurred_at       TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);
CREATE INDEX idx_transitions_issue ON transitions(issue_id);

CREATE TABLE dispatches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id          TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  attempt           INTEGER NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  exit_code         INTEGER,
  outcome           TEXT,
  correlation_id    TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(issue_id)
);

CREATE TABLE schema_meta (
  version INTEGER NOT NULL
);
INSERT INTO schema_meta (version) VALUES (1);
