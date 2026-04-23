from typing import Optional, List
from collections import deque
from urllib.parse import urljoin, urlparse
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import logging
from playwright.async_api import async_playwright, Browser
from services.embedder import chunk_text, embed_texts
from services.retriever import store_chunks, check_exists
from services.sqlite_store import upsert_ingest, init_db as init_sqlite

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()


async def fetch_page_playwright(url: str, browser: Browser):
    """Fetch a URL using Playwright and return (text, links). Returns (None, []) on failure."""
    try:
        page = await browser.new_page()
        # Use domcontentloaded instead of networkidle. Many modern sites have constant background polling
        # which prevents networkidle from ever firing, causing 30s timeouts.
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # Give it a short explicit wait for any initial JS to render
        await page.wait_for_timeout(2000)

        result = await page.evaluate('''() => {
            const text = document.body ? document.body.innerText : "";
            const links = Array.from(document.querySelectorAll("a[href]")).map(a => a.href);
            return {text, links};
        }''')

        await page.close()

        text = result["text"]
        links = result["links"]

        # Strip fragments and keep only http/https links
        valid_links = [l.split("#")[0] for l in links if l.startswith("http")]

        return text, valid_links
    except Exception as e:
        logger.error(f"Playwright error fetching {url}: {e}")
        return None, []


async def crawl(start_url: str, max_pages: int = 1) -> List[str]:
    """BFS crawl of same-domain pages using async Playwright."""
    logger.info(f"Starting BFS crawl. Target start URL: {start_url}, max_pages limit: {max_pages}")
    root_domain = urlparse(start_url).netloc
    visited = set()
    queue = deque([start_url])
    all_texts = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)

        while queue and len(visited) < max_pages:
            url = queue.popleft()
            if url in visited:
                continue
            visited.add(url)

            text, links = await fetch_page_playwright(url, browser)
            if text and text.strip():
                logger.info(f"Successfully scraped: {url} (Extracted {len(text)} characters, {len(links)} links)")
                all_texts.append(f"[Page: {url}]\n{text}")
            else:
                logger.warning(f"Failed to scrape text or page empty: {url}")

            for link in links:
                if link not in visited and urlparse(link).netloc == root_domain:
                    queue.append(link)

        await browser.close()

    return all_texts


class IngestRequest(BaseModel):
    url: str
    page_text: Optional[str] = None   # If omitted, backend fetches the URL itself
    max_pages: Optional[int] = 5     # Set > 1 to crawl linked pages on same domain
    title: Optional[str] = None      # Page title (from extension); stored in SQLite


class IngestResponse(BaseModel):
    status: str
    chunk_count: int
    pages_scraped: int
    source: str  # "extension" or "backend_fetch"


@router.post("/ingest", response_model=IngestResponse)
async def ingest(request: IngestRequest):
    """Ingest a web page into ChromaDB.

    - If page_text is provided (from Chrome extension), use it directly.
    - If not, the backend fetches the URL itself.
    - Set max_pages > 1 to crawl and ingest linked same-domain pages too.
    """
    source = "extension"
    pages_scraped = 1

    if not request.page_text or not request.page_text.strip():
        source = "backend_fetch"
        max_pages = max(5, request.max_pages or 5)
        page_texts = await crawl(request.url, max_pages=max_pages)
        pages_scraped = len(page_texts)

        if not page_texts:
            raise HTTPException(status_code=502, detail=f"Could not scrape any content from {request.url}")

        logger.info(f"Finished crawling. Scraped {pages_scraped} pages successfully.")
        
        # Combine all page texts into one corpus for chunking
        combined_text = "\n\n===PAGE BREAK===\n\n".join(page_texts)
    else:
        logger.info("Received raw page text via extension directly. Skipping crawler.")
        combined_text = request.page_text

    logger.info(f"Total corpus text size to chunk: {len(combined_text)} characters")

    # Chunk, embed, store
    chunks = chunk_text(combined_text)
    
    if not chunks:
        raise HTTPException(status_code=400, detail="No chunks generated from text")
        
    logger.info(f"Text divided into {len(chunks)} overlapping chunks.")

    embeddings = embed_texts(chunks)
    count = store_chunks(request.url, chunks, embeddings)

    init_sqlite()
    upsert_ingest(
        request.url, request.title, count, source
    )

    return IngestResponse(
        status="ok",
        chunk_count=count,
        pages_scraped=pages_scraped,
        source=source,
    )

@router.get("/check")
async def check_url(url: str):
    """Check if a URL has already been ingested in the DB."""
    return check_exists(url)

