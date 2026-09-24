import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined;
}

// 빌드 시 여러 워커가 동시에 DB를 열 수 있으므로 잠금 대기 시간을 넉넉히 둔다
const db = global.__db ?? new Database(dbPath, { timeout: 15000 });
if (process.env.NODE_ENV !== "production") global.__db = db;

// 저널 모드 변경은 다른 연결이 있으면 즉시 SQLITE_BUSY가 나므로 필요할 때만 바꾼다
if (db.pragma("journal_mode", { simple: true }) !== "wal") {
  try {
    db.pragma("journal_mode = WAL");
  } catch (err) {
    console.warn("WAL 모드 전환 실패 (다른 연결이 사용 중):", err);
  }
}
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    order_index INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS regions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    source_text TEXT NOT NULL DEFAULT '',
    translated_text TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS translation_pairs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    source_text TEXT NOT NULL,
    target_text TEXT NOT NULL,
    context TEXT DEFAULT '',
    confidence REAL DEFAULT 1.0,
    reviewed INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS page_logs (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'success',
    error_msg TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    region_id TEXT REFERENCES regions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    result TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS lora_stats (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    total_pairs INTEGER DEFAULT 0,
    reviewed_pairs INTEGER DEFAULT 0,
    high_quality_pairs INTEGER DEFAULT 0,
    training_status TEXT DEFAULT 'pending',
    training_progress INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pages_project ON pages(project_id);
  CREATE INDEX IF NOT EXISTS idx_regions_page ON regions(page_id);
  CREATE INDEX IF NOT EXISTS idx_translation_pairs_project ON translation_pairs(project_id);
  CREATE INDEX IF NOT EXISTS idx_translation_pairs_reviewed ON translation_pairs(reviewed);
  CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_lora_stats_project ON lora_stats(project_id);
`);

export default db;
