-- PKH-maker3 Cloudflare D1 (SQLite) 스키마

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_character TEXT NOT NULL DEFAULT 'guinea',
  best_survival_sec INTEGER NOT NULL DEFAULT 0,
  best_role_counts TEXT NOT NULL DEFAULT '{}',
  play_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_ranking
  ON users (best_score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS score_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  character_id TEXT NOT NULL,
  survival_sec INTEGER NOT NULL DEFAULT 0,
  role_counts TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_score_logs_user
  ON score_logs (user_id, created_at DESC);
