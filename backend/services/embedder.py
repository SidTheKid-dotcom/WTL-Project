import os
from typing import List
from google import genai
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "gemini-embedding-001"
CHUNK_SIZE = 2000  # characters (~500 tokens)
CHUNK_OVERLAP = 200

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    return _client


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks."""
    if not text or not text.strip():
        return []

    # Clean up the text
    text = text.strip()

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start += chunk_size - overlap

    return chunks


import time

def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed a list of texts using Gemini gemini-embedding-001."""
    if not texts:
        return []

    logger.info(f"Preparing to embed {len(texts)} chunks using {EMBEDDING_MODEL}")

    # Gemini embedding API supports batching
    # Process in much smaller batches. Free tier rejects massive 35k-token payloads in one request.
    all_embeddings = []
    batch_size = 10  # Reduced from 100

    num_batches = (len(texts) + batch_size - 1) // batch_size

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        total_chars = sum(len(chunk) for chunk in batch)
        estimated_tokens = total_chars // 4  # Rule of thumb: 1 token ~= 4 chars

        batch_num = (i // batch_size) + 1
        logger.info(f"Sending batch {batch_num}/{num_batches}: {len(batch)} chunks, {total_chars} chars, ~{estimated_tokens} tokens")
        try:
            result = _get_client().models.embed_content(
                model=EMBEDDING_MODEL,
                contents=batch,
            )
            all_embeddings.extend([e.values for e in result.embeddings])
            
            logger.info(f"Successfully received {len(batch)} embeddings. Total embedded: {len(all_embeddings)}/{len(texts)}")
            
            # Avoid hitting free-tier RPM rate limits if there are multiple batches
            if len(texts) > batch_size and (i + batch_size) < len(texts):
                logger.info("Sleeping for 8 seconds to respect Gemini Free Tier TPM/RPM limits...")
                time.sleep(8)
        except Exception as e:
            logger.error(f"Error embedding batch {batch_num}: {e}")
            raise e

    logger.info(f"Completed embedding {len(all_embeddings)} total chunks.")
    return all_embeddings
