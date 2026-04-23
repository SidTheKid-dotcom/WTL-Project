const BACKEND_URL = 'http://localhost:8000';

let conversationHistory = [];
let currentUrl = '';
let isActivated = false;

// DOM elements
const activateBtn = document.getElementById('activate-btn');
const statusEl = document.getElementById('status');
const pageInfoEl = document.getElementById('page-info');
const pageTitleEl = document.getElementById('page-title');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const introSplash = document.getElementById('intro-splash');
const introContinue = document.getElementById('intro-continue');
const appEl = document.getElementById('app');

let introParticleTeardown = null;

/**
 * Constellation-style particles (Canvas 2D, no libraries). Stops on teardown.
 */
function initIntroParticles() {
  const canvas = document.getElementById('intro-particles');
  const splash = document.getElementById('intro-splash');
  if (!canvas || !splash) {
    return function () {};
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return function () {};
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  const n = 40;
  const linkDist = 72;
  const ps = [];
  let w = 0;
  let h = 0;
  let raf = 0;
  let running = true;

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = splash.clientWidth;
    h = splash.clientHeight;
    if (w < 1 || h < 1) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    ps.length = 0;
    for (let i = 0; i < n; i++) {
      ps.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  function step() {
    if (ps.length < n) return;
    for (const p of ps) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) {
        p.x = 0;
        p.vx *= -1;
      } else if (p.x > w) {
        p.x = w;
        p.vx *= -1;
      }
      if (p.y < 0) {
        p.y = 0;
        p.vy *= -1;
      } else if (p.y > h) {
        p.y = h;
        p.vy *= -1;
      }
    }
  }

  function draw() {
    if (w < 1) return;
    ctx.clearRect(0, 0, w, h);
    if (ps.length < n) return;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ps[i];
        const b = ps[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < linkDist) {
          const o = 0.06 * (1 - d / linkDist);
          ctx.strokeStyle = `rgba(130, 140, 200, ${o})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const p of ps) {
      ctx.fillStyle = 'rgba(210, 210, 230, 0.2)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop() {
    if (!running) return;
    step();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function onResize() {
    layout();
    if (w > 0 && h > 0) {
      if (ps.length === 0) {
        seed();
      } else {
        for (const p of ps) {
          p.x = Math.min(p.x, w);
          p.y = Math.min(p.y, h);
        }
      }
    }
  }

  layout();
  onResize();
  raf = requestAnimationFrame(loop);
  window.addEventListener('resize', onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(splash);

  return function stopIntroParticles() {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    ro.disconnect();
  };
}

/**
 * Load packaged XML and merge into the intro (namespace-aware DOM, DOMParser).
 */
async function applyLabMetaXml() {
  const kicker = document.getElementById('intro-kicker');
  if (!kicker) return;
  try {
    const text = await (await fetch(chrome.runtime.getURL('lab-meta.xml'))).text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return;
    }
    const fromXml = doc
      .getElementsByTagNameNS('urn:intercom:lab', 'kicker')[0]
      ?.textContent?.trim();
    if (fromXml) {
      kicker.textContent = fromXml;
    }
  } catch (e) {
    /* default HTML copy stays */
  }
}

/**
 * Send a message to the tab's content script. If nothing is listening (e.g. tab
 * open before extension reload), inject content.js and retry.
 */
async function sendToContentTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch (injectErr) {
      const msg = injectErr?.message || String(injectErr);
      throw new Error(
        'Cannot run on this page. Open a normal http(s) page and refresh it, then try again. ' +
          msg
      );
    }
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// ─── Intro splash → then boot chat ─────────────────────

function finishIntro() {
  if (!introSplash || introSplash.classList.contains('intro-splash--exit')) return;
  if (introContinue) introContinue.disabled = true;
  if (typeof introParticleTeardown === 'function') {
    introParticleTeardown();
    introParticleTeardown = null;
  }
  let completed = false;
  const complete = () => {
    if (completed) return;
    completed = true;
    if (introSplash && introSplash.parentNode) {
      introSplash.remove();
    }
    if (appEl) {
      appEl.removeAttribute('aria-hidden');
    }
    startBoot();
  };
  introSplash.classList.add('intro-splash--exit');
  introSplash.addEventListener(
    'transitionend',
    (e) => {
      if (e.target === introSplash && e.propertyName === 'opacity') {
        complete();
      }
    },
    { once: true }
  );
  setTimeout(complete, 700);
}

if (introContinue) {
  introContinue.addEventListener('click', finishIntro);
  introContinue.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      finishIntro();
    }
  });
}

// ─── Auto-Initialization (after intro) ─────────────────

async function startBoot() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.startsWith('http')) {
      setStatus('error', 'Open a normal website first.');
      return;
    }

    currentUrl = tab.url;
    pageTitleEl.textContent = `📄 ${tab.title}`;
    pageInfoEl.classList.remove('hidden');

    setStatus('loading', 'Checking memory...');
    const res = await fetch(`${BACKEND_URL}/check?url=${encodeURIComponent(tab.url)}`);

    if (res.ok) {
      const data = await res.json();
      if (data.exists) {
        isActivated = true;
        setStatus('ready', `Ready · ${data.chunk_count} chunks (Cached)`);
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messagesEl.innerHTML = '';
        addMessage('system', `Loaded from agent memory: "${tab.title}" (${data.chunk_count} chunks). Ask me anything!`);
        activateBtn.style.display = 'none';
        return;
      }
    }

    activateBtn.click();
  } catch (e) {
    setStatus('error', `Initialization error: ${e.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  applyLabMetaXml();
  introParticleTeardown = initIntroParticles();
  if (introContinue) {
    introContinue.focus();
  } else {
    if (appEl) appEl.removeAttribute('aria-hidden');
    startBoot();
  }
});

// ─── Activate ───────────────────────────────────────────

activateBtn.addEventListener('click', async () => {
  try {
    setStatus('loading', 'Scraping page...');
    activateBtn.disabled = true;

    // Get current tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const pageData = await sendToContentTab(tab.id, { type: 'scrape' });

    if (!pageData || !pageData.text) {
      throw new Error('Failed to scrape page');
    }

    currentUrl = pageData.url;
    pageTitleEl.textContent = `📄 ${pageData.title}`;
    pageInfoEl.classList.remove('hidden');

    setStatus('loading', 'Ingesting...');

    // Send to backend for ingestion
    const response = await fetch(`${BACKEND_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: pageData.url,
        page_text: pageData.text,
        title: pageData.title || null,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Ingestion failed (${response.status})`);
    }

    const result = await response.json();

    isActivated = true;
    setStatus('ready', `Ready · ${result.chunk_count} chunks`);
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();

    // Clear welcome and add system message
    messagesEl.innerHTML = '';
    addMessage(
      'system',
      `Page loaded: "${pageData.title}" — ${result.chunk_count} chunks indexed. Ask me anything!`
    );
    conversationHistory = [];
  } catch (error) {
    setStatus('error', error.message);
    activateBtn.disabled = false;
  }
});

// ─── Chat ───────────────────────────────────────────────

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !isActivated) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Add user message
  addMessage('user', message);
  conversationHistory.push({ role: 'user', content: message });

  // Show loading
  const loadingEl = addLoadingIndicator();

  // Disable input while waiting
  messageInput.disabled = true;
  sendBtn.disabled = true;

  try {
    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentUrl,
        message: message,
        conversation_history: conversationHistory.slice(-10), // Last 10 messages
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `Chat failed (${response.status})`);
    }

    const result = await response.json();

    // Remove loading indicator
    loadingEl.remove();

    // Add assistant message
    // If there are multiple actions, we'll just pass the first one to addMessage for the UI bubble visualization, or pass null and add them manually
    addMessage('assistant', result.answer, result.actions && result.actions.length > 0 ? result.actions[0] : null);
    conversationHistory.push({ role: 'assistant', content: result.answer });

    // Execute actions sequentially
    if (result.actions && result.actions.length > 0) {
      for (const act of result.actions) {
        await executeAction(act);
        // Add a slight delay between actions for UI to catch up
        await new Promise(r => setTimeout(r, 600));
      }
    }
  } catch (error) {
    loadingEl.remove();
    addMessage('system', `Error: ${error.message}`);
  } finally {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// ─── Actions ────────────────────────────────────────────

async function executeAction(action) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    switch (action.type) {
      case 'navigate':
        chrome.runtime.sendMessage({ type: 'navigate', url: action.url });
        addMessage('system', `🔗 Navigating to ${action.url}`);
        break;

      case 'scroll_to':
        await sendToContentTab(tab.id, {
          type: 'scroll_to',
          selector: action.selector,
        });
        addMessage('system', `📍 Scrolled to ${action.selector}`);
        break;

      case 'highlight':
        await sendToContentTab(tab.id, {
          type: 'highlight',
          text: action.text,
        });
        addMessage('system', `✨ Highlighted "${action.text}"`);
        break;

      case 'click':
        var res = await sendToContentTab(tab.id, {
          type: 'click',
          selector: action.selector,
        });
        if (res && res.success) {
            addMessage('system', `🖱️ Clicked ${action.selector}`);
        } else {
            throw new Error(res?.error || 'Element not found');
        }
        break;

      case 'type_text':
        var res = await sendToContentTab(tab.id, {
          type: 'type_text',
          selector: action.selector,
          text: action.text,
        });
        if (res && res.success) {
            addMessage('system', `⌨️ Typed "${action.text}" into ${action.selector}`);
        } else {
            throw new Error(res?.error || 'Element not found');
        }
        break;
    }
  } catch (e) {
    addMessage('system', `⚠️ Action failed: ${e.message}`);
  }
}

// ─── UI Helpers ─────────────────────────────────────────

function setStatus(type, text) {
  statusEl.textContent = text;
  statusEl.className = `status status-${type}`;
}

function addMessage(type, text, action = null) {
  const msgEl = document.createElement('div');
  msgEl.className = `message message-${type}`;
  msgEl.textContent = text;

  if (action) {
    const actionEl = document.createElement('div');
    actionEl.className = 'message-action';
    let detail = action.type;
    if (action.url) detail += ` → ${action.url}`;
    if (action.selector) detail += ` → ${action.selector}`;
    if (action.text) detail += ` → "${action.text}"`;
    actionEl.textContent = `🔧 ${detail}`;
    msgEl.appendChild(actionEl);
  }

  messagesEl.appendChild(msgEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return msgEl;
}

function addLoadingIndicator() {
  const loadingEl = document.createElement('div');
  loadingEl.className = 'message message-assistant';
  loadingEl.innerHTML =
    '<div class="loading-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(loadingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return loadingEl;
}
