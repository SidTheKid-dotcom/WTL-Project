# Browser Extension Build Plan — "Intercom for any website"

---

## What we're building

A Chrome extension where:
1. User logs in
2. Clicks "Activate" on any website → extension scrapes the page
3. A chatbot sidebar opens — user can ask questions about that site
4. LLM can also **act** on the page (navigate to contact page, scroll to section, click links)

---

## Tech Stack

| Layer | Choice |
|---|---|
| Extension (UI) | HTML + CSS + Vanilla JS |
| Backend | Python (FastAPI) |
| LLM | Claude API |
| Auth | Supabase |
| Vector DB | ChromaDB |

---

## Architecture

```
[Chrome Extension]
     |
     |--- scrape page → send to backend
     |--- chat messages → send to backend
     |--- receive "actions" → execute in browser (navigate, click, scroll)
     |
[FastAPI Backend]
     |
     |--- /ingest  → chunk + embed + store in ChromaDB (per session/URL)
     |--- /chat    → RAG query + Claude call + optional tool call response
     |--- /auth    → verify Supabase JWT
     |
[Claude API]  +  [ChromaDB]  +  [Supabase]
```

---

## Extension File Structure
```
extension/
  manifest.json        ← declares permissions
  popup.html           ← the sidebar UI
  popup.js             ← logic
  content.js           ← injected into every page (can read DOM)
  background.js        ← service worker (handles events)
  styles.css
```

### manifest.json (key parts)
```json
{
  "manifest_version": 3,
  "name": "PageChat",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": { "default_popup": "popup.html" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"] }],
  "background": { "service_worker": "background.js" }
}
```

**Important:** Chrome extensions have 3 separate JS contexts (popup, content script, background) that can't directly talk to each other — they use message passing. `content.js` is what actually reads the page. `popup.js` cannot.

---

## Backend File Structure
```
backend/
  main.py
  routes/
    ingest.py
    chat.py
    auth.py
  services/
    embedder.py     ← chunk + embed text
    retriever.py    ← query ChromaDB
    llm.py          ← Claude API call
```

### /ingest endpoint
```
POST /ingest
Body: { user_id, url, page_text }

Steps:
1. Split page_text into ~500 token chunks
2. Embed each chunk
3. Store in ChromaDB with collection_id = f"{user_id}_{url}"
4. Return { status: "ok", chunk_count: N }
```

### /chat endpoint
```
POST /chat
Body: { user_id, url, message, conversation_history }

Steps:
1. Embed the user message
2. Query ChromaDB → get top 5 relevant chunks
3. Build prompt = system prompt + retrieved chunks + chat history + user message
4. Call Claude API
5. Parse response — plain answer OR action?
6. Return { answer: "...", action: null }
        OR { answer: "...", action: { type: "navigate", url: "..." } }
```

---

## Auth — Supabase

- Create a free project at supabase.com, enable Email auth
- Extension stores the JWT in `chrome.storage.local` after login
- Every backend request includes the token in the Authorization header
- Backend verifies it with the Supabase SDK

---

## Agentic Actions

Claude responds with structured JSON when it wants to perform a browser action.

### System prompt addition
```
When a user asks you to navigate or perform an action, respond in this format:
{
  "answer": "Sure! Taking you to the contact page.",
  "action": { "type": "navigate", "url": "https://example.com/contact" }
}
If no action is needed, set "action" to null.

Available actions:
- navigate: { type: "navigate", url: "string" }
- scroll_to: { type: "scroll_to", selector: "css selector" }
- highlight: { type: "highlight", text: "text to highlight on page" }
```

### Extension handles it like this
```js
const { answer, action } = await callChat(message)
renderMessage(answer)

if (action?.type === 'navigate') {
  chrome.tabs.update({ url: action.url })
}
if (action?.type === 'scroll_to') {
  chrome.tabs.sendMessage(tabId, { type: 'scroll_to', selector: action.selector })
}
```

---

## Division of Work

| Person | Owns |
|---|---|
| Siddhant | Backend (FastAPI, ChromaDB, Claude API, agentic actions) |
| Friend 1 | Extension shell, content.js, popup.js wiring |
| Friend 2 | Auth (Supabase), UI/CSS for sidebar |

---

## Build Order (strict)

1. Extension opens sidebar + reads page text → console.log ✅
2. Backend /ingest stores text in ChromaDB ✅
3. Backend /chat returns an answer ✅
4. Extension sends page text to /ingest on Activate click ✅
5. Extension sends chat messages and renders responses ✅
6. Add Supabase auth ✅
7. Add agentic actions (navigate, scroll) ✅
8. Polish UI ✅

---

## Common mistakes to avoid

- **Don't use Manifest V2** — Chrome is deprecating it, use V3
- **Don't scrape the DOM from popup.js** — popups can't access the page, use content.js for that
- **CORS** — add FastAPI CORS middleware from day 1 or extension requests will silently fail
- **ChromaDB persistence** — pass a `path=` argument so data survives server restarts
- **Send the token** — include the Supabase JWT in the Authorization header on every request
