"""
SQLite index for ingested pages (URL, chunk count, title, source).
Complements ChromaDB vectors; /check can resolve from SQLite first.
"""
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, Optional

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(_DATA_DIR, "intercom.db")


def _connect() -> sqlite3.Connection:
    os.makedirs(_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingested_pages (
                url TEXT PRIMARY KEY,
                title TEXT,
                chunk_count INTEGER NOT NULL,
                source TEXT,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def upsert_ingest(
    url: str, title: Optional[str], chunk_count: int, source: str
) -> None:
    init_db()
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO ingested_pages (url, title, chunk_count, source, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                title=excluded.title,
                chunk_count=excluded.chunk_count,
                source=excluded.source,
                updated_at=excluded.updated_at
            """,
            (url, title, chunk_count, source, now),
        )
        conn.commit()


def get_ingest(url: str) -> Optional[Dict[str, Any]]:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT url, title, chunk_count, source, updated_at "
            "FROM ingested_pages WHERE url = ?",
            (url,),
        ).fetchone()
    if not row:
        return None
    return dict(row)
