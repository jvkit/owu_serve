import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';

const dbDir = path.dirname(config.dbPath);
try {
    fs.mkdirSync(dbDir, { recursive: true });
} catch {
    // ignore
}

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

export function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        email TEXT PRIMARY KEY,
        user_id TEXT,
        user_name TEXT,
        user_role TEXT,
        token_id INTEGER,
        token_name TEXT NOT NULL,
        token_key TEXT NOT NULL,
        remain_quota INTEGER NOT NULL DEFAULT 0,
        used_quota INTEGER NOT NULL DEFAULT 0,
        unlimited_quota INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_plans (
        user_email TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tier INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        next_tier INTEGER,
        next_expires_at TEXT,
        extra_quota INTEGER NOT NULL DEFAULT 0,
        kb_purged_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS purged_users (
        email TEXT PRIMARY KEY,
        purged_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_storage (
        user_email TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        storage_quota INTEGER NOT NULL DEFAULT 1073741824,
        storage_used INTEGER NOT NULL DEFAULT 0,
        file_count_quota INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS collections (
        id TEXT NOT NULL,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        owu_collection_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id, user_email)
      );
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        parse_strategy TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploaded',
        progress INTEGER NOT NULL DEFAULT 0,
        parse_progress INTEGER DEFAULT 0,
        ocr_task_id TEXT,
        error TEXT,
        disk_path TEXT NOT NULL,
        parsed_path TEXT,
        source_ext TEXT NOT NULL,
        owu_file_id TEXT,
        owu_status TEXT,
        owu_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_storage_email ON user_storage(user_email);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_collections_email ON collections(user_email);`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_default_per_user ON collections(user_email, is_default) WHERE is_default = 1;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_email ON files(user_email);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_files_collection ON files(collection_id);`);

    // Safe migrations
    const migrations = [
        'ALTER TABLE files ADD COLUMN owu_file_id TEXT',
        'ALTER TABLE files ADD COLUMN owu_status TEXT',
        'ALTER TABLE files ADD COLUMN owu_error TEXT',
        'ALTER TABLE collections ADD COLUMN owu_collection_id TEXT',
        'ALTER TABLE files ADD COLUMN parse_progress INTEGER DEFAULT 0',
        'ALTER TABLE user_tokens ADD COLUMN user_role TEXT',
    ];
    for (const sql of migrations) {
        try {
            db.exec(sql);
        } catch {
            // column likely exists
        }
    }
}

initSchema();
