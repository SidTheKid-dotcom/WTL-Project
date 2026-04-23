// Background service worker — handles side panel + tab-level operations

// Open side panel when extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from sidepanel for tab-level operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'navigate') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.update(tabs[0].id, { url: message.url });
        sendResponse({ success: true });
      }
    });
    return true; // Keep message channel open for async response
  }

  if (message.type === 'get_tab_id') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tabId: tabs[0]?.id });
    });
    return true;
  }
});
