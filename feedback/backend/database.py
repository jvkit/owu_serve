import logging
import os
import sqlite3
from contextlib import contextmanager

log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("FEEDBACK_DATA_DIR", os.path.join(BASE_DIR, "data"))


def get_db_path() -> str:
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, "feedback.db")


def get_uploads_dir() -> str:
    uploads_dir = os.environ.get("FEEDBACK_UPLOADS_DIR", os.path.join(BASE_DIR, "uploads"))
    os.makedirs(uploads_dir, exist_ok=True)
    return uploads_dir


@contextmanager
def get_db():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    db_path = get_db_path()
    log.info(f"Initializing feedback database at {db_path}")
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS fb_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL UNIQUE,
                name TEXT,
                department TEXT,
                phone TEXT,
                email TEXT,
                remark TEXT,
                join_ranking INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS fb_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL,
                category TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'other',
                description TEXT NOT NULL,
                remark TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                handler TEXT,
                handle_note TEXT,
                handled_at TEXT,
                is_carousel INTEGER NOT NULL DEFAULT 0,
                carousel_text TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_fb_feedback_account ON fb_feedback(account);
            CREATE INDEX IF NOT EXISTS idx_fb_feedback_status ON fb_feedback(status);
            CREATE INDEX IF NOT EXISTS idx_fb_feedback_created_at ON fb_feedback(created_at);

            CREATE TABLE IF NOT EXISTS fb_attachment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feedback_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                FOREIGN KEY (feedback_id) REFERENCES fb_feedback(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_fb_attachment_feedback_id ON fb_attachment(feedback_id);
            """
        )
        conn.commit()

    # Migration: add columns that may be missing in older databases
    with sqlite3.connect(db_path) as conn:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(fb_feedback)")]
        if "remark" not in columns:
            conn.execute("ALTER TABLE fb_feedback ADD COLUMN remark TEXT")
            conn.commit()

    os.makedirs(get_uploads_dir(), exist_ok=True)
