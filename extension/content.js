// Content script — runs in the context of every web page
// Handles: DOM scraping, scrolling to elements, highlighting text
// Re-bind on each injection so a fresh listener exists after extension reload + executeScript.
function intercomMessageHandler(message, sender, sendResponse) {
  if (message.type === 'scrape') {
    const data = scrapePage();
    sendResponse(data);
  }

  if (message.type === 'scroll_to') {
    try {
      const element = document.querySelector(message.selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Briefly highlight the element
        const originalOutline = element.style.outline;
        element.style.outline = '3px solid #6366f1';
        element.style.outlineOffset = '2px';
        setTimeout(() => {
          element.style.outline = originalOutline;
          element.style.outlineOffset = '';
        }, 3000);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Element not found' });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }

  if (message.type === 'highlight') {
    highlightText(message.text);
    sendResponse({ success: true });
  }

  if (message.type === 'click') {
    try {
      const element = document.querySelector(message.selector);
      if (element) {
        element.click();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Element not found' });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }

  if (message.type === 'type_text') {
    try {
      const element = document.querySelector(message.selector);
      if (element) {
        element.focus();

        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            // React 16+ overrides the value setter, we need to bypass it
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window[element.tagName === 'INPUT' ? 'HTMLInputElement' : 'HTMLTextAreaElement'].prototype,
                'value'
            ).set;
            if (nativeSetter) {
                nativeSetter.call(element, message.text);
            } else {
                element.value = message.text;
            }
        } else if (element.isContentEditable) {
            element.innerText = message.text;
        } else {
            element.value = message.text; // fallback
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Element not found' });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }

  return true; // Keep channel open for async
}

if (window.__intercomMessageHandler) {
  try {
    chrome.runtime.onMessage.removeListener(window.__intercomMessageHandler);
  } catch (e) {
    /* invalid after reload */
  }
}
window.__intercomMessageHandler = intercomMessageHandler;
chrome.runtime.onMessage.addListener(intercomMessageHandler);

function scrapePage() {
  // Get page metadata
  const title = document.title;
  const url = window.location.href;
  const metaDesc =
    document.querySelector('meta[name="description"]')?.content || '';

  // Get all headings
  const headings = Array.from(
    document.querySelectorAll('h1, h2, h3, h4, h5, h6')
  )
    .map((h) => `${h.tagName}: ${h.innerText.trim()}`)
    .filter((h) => h.length > 4)
    .join('\n');

  // Get main text content
  const bodyText = document.body.innerText;

  // Get links (capped at 100)
  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 100)
    .map((a) => {
      const text = a.innerText.trim();
      return text ? `[${text}](${a.href})` : null;
    })
    .filter(Boolean)
    .join('\n');

  // Get interactive elements
  const interactiveEls = Array.from(
    document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a.btn')
  )
    .slice(0, 100)
    .map((el) => {
      let idStr = el.id ? `#${el.id}` : '';
      let classStr = el.className && typeof el.className === 'string' ? `.${el.className.split(' ').join('.')}` : '';
      let nameStr = el.name ? `[name='${el.name}']` : '';
      let typeStr = el.type ? `[type='${el.type}']` : '';
      let selector = `${el.tagName.toLowerCase()}${idStr}${nameStr || classStr}`;
      
      let label = el.labels && el.labels[0] ? el.labels[0].innerText.trim() : '';
      let placeholder = el.placeholder || '';
      let text = el.innerText || el.value || '';
      
      const details = [
        label ? `Label: "${label}"` : '',
        placeholder ? `Placeholder: "${placeholder}"` : '',
        text.trim() ? `Text/Value: "${text.trim()}"` : ''
      ].filter(Boolean).join(' | ');

      return `[${el.tagName}] selector: "${selector}" -> ${details}`;
    })
    .filter(Boolean)
    .join('\n');

  const fullText = `Title: ${title}
URL: ${url}
Description: ${metaDesc}

--- Headings ---
${headings}

--- Interactive Elements ---
${interactiveEls}

--- Page Content ---
${bodyText}

--- Links on Page ---
${links}`;

  return {
    url,
    title,
    text: fullText,
  };
}


function highlightText(searchText) {
  // Remove previous highlights
  document.querySelectorAll('.intercom-highlight').forEach((el) => {
    const parent = el.parentNode;
    parent.replaceChild(document.createTextNode(el.textContent), el);
    parent.normalize();
  });

  if (!searchText) return;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  const matchingNodes = [];
  while (walker.nextNode()) {
    if (
      walker.currentNode.textContent
        .toLowerCase()
        .includes(searchText.toLowerCase())
    ) {
      matchingNodes.push(walker.currentNode);
    }
  }

  // Highlight first 5 matches
  let firstHighlight = null;
  matchingNodes.slice(0, 5).forEach((node) => {
    const text = node.textContent;
    const idx = text.toLowerCase().indexOf(searchText.toLowerCase());
    if (idx < 0) return;

    const before = document.createTextNode(text.substring(0, idx));
    const match = document.createTextNode(
      text.substring(idx, idx + searchText.length)
    );
    const after = document.createTextNode(
      text.substring(idx + searchText.length)
    );

    const span = document.createElement('span');
    span.className = 'intercom-highlight';
    span.style.backgroundColor = '#6366f1';
    span.style.color = 'white';
    span.style.padding = '2px 4px';
    span.style.borderRadius = '3px';
    span.appendChild(match);

    const parent = node.parentNode;
    parent.insertBefore(before, node);
    parent.insertBefore(span, node);
    parent.insertBefore(after, node);
    parent.removeChild(node);

    if (!firstHighlight) firstHighlight = span;
  });

  // Scroll to first highlight
  if (firstHighlight) {
    firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
