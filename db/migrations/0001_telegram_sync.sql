CREATE TABLE IF NOT EXISTS telegram_messages (
  message_id INTEGER PRIMARY KEY,
  media_group_id TEXT,
  raw_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_product_state (
  product_id INTEGER PRIMARY KEY,
  removed INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_product_snapshots (
  product_id INTEGER PRIMARY KEY,
  product_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_analytics (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  event TEXT NOT NULL,
  source TEXT NOT NULL,
  country TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, event, source, country)
);
