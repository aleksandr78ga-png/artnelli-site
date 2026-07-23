export const telegramMessagesSchema = `
CREATE TABLE IF NOT EXISTS telegram_messages (
  message_id INTEGER PRIMARY KEY,
  media_group_id TEXT,
  raw_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

export const telegramProductStateSchema = `
CREATE TABLE IF NOT EXISTS telegram_product_state (
  product_id INTEGER PRIMARY KEY,
  removed INTEGER NOT NULL DEFAULT 0,
  checked_at TEXT,
  updated_at TEXT NOT NULL
)`;

export const telegramSyncStateSchema = `
CREATE TABLE IF NOT EXISTS telegram_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;
