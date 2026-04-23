import os
import hashlib
from typing import List
import chromadb

# Use persistent local storage (no Docker needed)
CHROMA_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_data")

# Singleton client
_client = None


def get_client():
    """Get ChromaDB persistent client (local, no Docker)."""
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client


def url_to_collection_name(url: str) -> str:
    """Convert URL to a valid ChromaDB collection name.
    
    ChromaDB collection names must be 3-63 chars, start/end with
    alphanumeric, and contain only alphanumeric, underscores, or hyphens.
    """
    h = hashlib.md5(url.encode()).hexdigest()[:16]
    return f"page_{h}"


def store_chunks(url: str, chunks: List[str], embeddings: List[List[float]]) -> int:
    """Store chunks and embeddings in ChromaDB. Returns chunk count."""
    client = get_client()
    collection_name = url_to_collection_name(url)
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"url": url},
    )

    # Generate IDs for each chunk
    ids = [f"{collection_name}_{i}" for i in range(len(chunks))]

    # Upsert to handle re-scraping the same page
    collection.upsert(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
    )

    return len(chunks)


def query(url: str, query_embedding: List[float], top_k: int = 5) -> List[str]:
    """Query ChromaDB for relevant chunks by URL."""
    client = get_client()
    collection_name = url_to_collection_name(url)

    try:
        collection = client.get_collection(name=collection_name)
    except Exception:
        return []

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
    )

    if results and results["documents"]:
        return results["documents"][0]
    return []


def _chroma_check_exists(url: str) -> dict:
    """Check Chroma for an indexed URL (legacy + vector source of truth)."""
    client = get_client()
    collection_name = url_to_collection_name(url)
    try:
        collection = client.get_collection(name=collection_name)
        count = collection.count()
        return {"exists": count > 0, "chunk_count": count}
    except Exception:
        return {"exists": False, "chunk_count": 0}


def check_exists(url: str) -> dict:
    """SQLite index first, then Chroma; backfill SQLite if only Chroma has data."""
    from services import sqlite_store

    sqlite_store.init_db()
    row = sqlite_store.get_ingest(url)
    if row and row.get("chunk_count", 0) > 0:
        return {"exists": True, "chunk_count": int(row["chunk_count"])}

    c = _chroma_check_exists(url)
    n = c.get("chunk_count") or 0
    if n > 0:
        sqlite_store.upsert_ingest(url, None, n, "chroma_backfill")
    return c
