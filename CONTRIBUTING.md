# Contributing to Social Cleaner

Thanks for contributing! Here's how to add a new platform or surface (e.g. an
Instagram "following" cleaner, or another Facebook list).

> **Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it explains the side-panel
> screens, the message protocol, and how a run is paced.

---

## The shape of a feature

Every cleaner follows the same flow: **scan → filter → confirm → run**. That maps
to a content-script module plus a popup panel:

- **content.js** — a module that `scan()`s the list and acts on selected items,
  reporting progress over the message channel.
- **popup** — a panel that shows the scanned list with filters, a confirm step,
  and Pause/Resume/Stop during the run.

---

## 1. Add a module in `content/content.js`

Chrome content scripts can't use ES modules, so everything is one file of
self-contained IIFEs. Add one alongside `Facebook` / `FacebookGroups` /
`FacebookFollowing`:

```js
const YourSurface = (() => {
  let _stop = false, _paused = false, _running = false, _done = 0;

  function isValidPage() {
    return location.href.includes('yourplatform.com/the-right-list');
  }

  // Return the items currently in the DOM. scrollCollectAll dedups by key.
  function collectVisible() {
    // ...return [{ href, name, /* subtitle/category */ }]
  }

  async function scan(_opts = {}) {
    if (_running) return;
    _running = true; _stop = false;
    sendStatus('🔍 Scanning…', 0);
    let items = [];
    try {
      items = await scrollCollectAll({          // shared robust scraper
        collect: collectVisible,
        key: i => i.href,
        onProgress: n => sendStatus(`🔍 Found ${n}…`, n),
        isStopped: () => _stop,
      });
    } finally { _running = false; }
    chrome.runtime.sendMessage({ target: 'popup', type: 'YOURS_LIST', items });
    sendStatus(`✅ Scan complete — ${items.length} found.`, items.length);
  }

  async function actOne(href) { /* returns 'ok' or a skip reason */ }

  async function actSelected({ hrefs = [] } = {}) {
    if (_running || !hrefs.length) return;
    _running = true; _stop = false; _paused = false; _done = 0;
    try {
      for (const href of hrefs) {
        await pauseGate();                 // honor Pause between items
        if (_stop) break;
        const result = await actOne(href);
        chrome.runtime.sendMessage({ target: 'popup', type: 'YOURS_RESULT', href, result });
        if (result === 'ok') _done++;
        await sleepPausable(rand(2000, 5000)); // human-paced, pausable
      }
      chrome.runtime.sendMessage({ target: 'popup', type: 'YOURS_DONE', count: _done, stopped: _stop });
    } finally { _running = false; _paused = false; }
  }

  function stop()   { _stop = true; _paused = false; }
  function pause()  { _paused = true; }
  function resume() { _paused = false; }

  return { isValidPage, scan, actSelected, stop, pause, resume };
})();
```

Reuse the shared helpers at the top of `content.js`: `sleep`, `sendStatus`,
`scrollCollectAll`, and (inside your module) the `rand` / `sleepPausable` /
`pauseGate` pacing pattern the other modules use.

## 2. Route its messages

In the `chrome.runtime.onMessage` switch at the bottom of `content.js`, add
`YOURS_SCAN`, `YOURS_ACT`, `YOURS_STOP` cases (and hook `PAUSE`/`RESUME` to your
module when its page is active).

## 3. Add the popup panel + routing

- Add a `#your-panel` with scan / review / confirm / running steps in `popup.html`
  (copy an existing panel).
- In `popup.js`: add the URL match to `urlMatchesFeature` and `FEATURE_URLS`, wire
  the scan/filter/confirm/run buttons, and handle `YOURS_LIST` / `YOURS_RESULT` /
  `YOURS_DONE` in the message listener.

---

## Verify against the live DOM — don't guess

Facebook's markup is obfuscated and changes. **Every selector in this project was
confirmed against the live page before shipping.** When adding a surface, inspect
the real DOM (which element opens the menu, whether a synthetic `.click()` works or
you need a full pointer sequence, what the confirm/undo looks like) and pick a
**definitive success signal** (an element detaching, a card disappearing) rather
than assuming the happy path.

---

## Pull request checklist

- [ ] Module exposes `isValidPage` / `scan` / an action / `stop` / `pause` / `resume`
- [ ] `_running` guard prevents concurrent runs
- [ ] Scan uses `scrollCollectAll` (handles long, virtualized, lazy-loaded lists)
- [ ] Action is **human-paced** (randomized) and honors **Pause/Stop** every item
- [ ] Success detection is verified against the live DOM, not assumed
- [ ] A confirm step guards anything destructive
- [ ] README + ARCHITECTURE updated for the new surface
