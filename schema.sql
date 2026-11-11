PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_areas_store ON areas(store_id, position);

CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  overview TEXT NOT NULL DEFAULT '',
  adjustment TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  tips TEXT NOT NULL DEFAULT '',
  safety TEXT NOT NULL DEFAULT '',
  video_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_machines_area ON machines(area_id, position);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  chunk_size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('uploading', 'ready')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_machine ON videos(machine_id);

CREATE TABLE IF NOT EXISTS video_chunks (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  PRIMARY KEY (video_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0
);

-- Video chunk keys waiting for safe, incremental KV deletion (Free Workers subrequest limits).
CREATE TABLE IF NOT EXISTS video_cleanup_jobs (
  video_id TEXT PRIMARY KEY,
  chunk_count INTEGER NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0
);

-- A manual's content is maintained once and may be assigned to multiple stores.
-- Existing standalone machine rows remain readable without backfilling data.
CREATE TABLE IF NOT EXISTS machine_manual_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  overview TEXT NOT NULL DEFAULT '',
  adjustment TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  tips TEXT NOT NULL DEFAULT '',
  safety TEXT NOT NULL DEFAULT '',
  thumbnail_state INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS machine_manual_members (
  machine_id TEXT PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES machine_manual_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_machine_manual_members_group ON machine_manual_members(group_id);
