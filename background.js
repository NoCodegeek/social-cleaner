/**
 * Social Cleaner - Background Service Worker
 * Handles message routing between popup and content scripts.
 */

// Open the side panel when the toolbar icon is clicked (replaces the old popup).
// Side panels persist while you work, unlike popups which close on any focus change.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {}); // ignore on browsers without sidePanel support

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward messages from popup to the active tab's content script
  if (message.target === 'content') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ error: 'no-tab' }); return; }
      chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
        // The content script may not be injected (wrong page, or an already-open
        // tab that wasn't reloaded after the extension updated). Reading
        // lastError here swallows the "Unchecked runtime.lastError" warning and
        // lets the popup fall back gracefully.
        if (chrome.runtime.lastError) {
          sendResponse({ error: 'no-content-script' });
          return;
        }
        sendResponse(response);
      });
    });
    return true; // Keep channel open for async response
  }

  // NOTE: content → popup messages are delivered to the popup DIRECTLY by
  // chrome.runtime.sendMessage. We must NOT re-broadcast them here, or every
  // status/log/result message arrives twice (double counters, double log rows).
});
