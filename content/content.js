/**
 * Social Cleaner - Content Script
 * All platform logic is bundled here since Chrome content scripts
 * do not support ES module imports.
 *
 * To add a new platform:
 * 1. Add a new platform object in the `platforms` array below
 * 2. Implement: name, isValidPage(), run(options), stop(), getCount()
 */

// Load marker — lets us confirm the content script actually injected on a page
// (visible in the page console and as a DOM attribute for diagnostics).
console.log('[Social Cleaner] content script loaded on', location.href);
try {
  document.documentElement.dataset.socialcleaner = chrome.runtime.getManifest().version;
} catch (e) {}

// ── Shared helpers ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Scroll down `distance` px as a series of small steps with brief pauses, so it
// glides like a mouse wheel instead of teleporting — gentler on lazy-loaders and
// less bot-like than a single jump. Returns how far we actually moved.
async function smoothScrollBy(distance, chunk = 90, gapMs = 20) {
  const startY = window.scrollY;
  let moved = 0;
  while (moved < distance) {
    const d = Math.min(chunk, distance - moved);
    window.scrollBy(0, d);
    moved += d;
    await sleep(gapMs);
  }
  return window.scrollY - startY;
}

function sendStatus(message, count) {
  try {
    chrome.runtime.sendMessage({ target: 'popup', type: 'STATUS', message, count });
  } catch(e) {}
}

function sendDone(count) {
  try {
    chrome.runtime.sendMessage({ target: 'popup', type: 'DONE', count });
  } catch(e) {}
}

// Robustly scrape a lazy-loading, infinite-scroll list.
//
// Scrolls INCREMENTALLY (a step smaller than the viewport, so consecutive
// absorbs overlap) — this is safe even if Facebook virtualizes the list and
// drops off-screen cards from the DOM; every card is absorbed as it passes
// through view. It's patient: it only stops once NEITHER the collected count,
// the page height, NOR the scroll position advances for `maxStable` consecutive
// rounds (so a slow lazy-load batch never causes an early exit). Dedups via
// `key`.
//
//   collect()     → array of items currently in the DOM
//   key(item)     → stable unique id (e.g. href)
//   onProgress(n) → called with the running unique count
//   isStopped()   → true to abort (user pressed Stop)
async function scrollCollectAll({ collect, key, onProgress, isStopped,
                                  stepPx = 1000, waitMs = 1500, maxStable = 6 }) {
  const seen = new Map();
  const absorb = () => {
    for (const item of collect()) {
      const k = key(item);
      if (k && !seen.has(k)) seen.set(k, item);
    }
  };
  let stable = 0;
  while (!isStopped() && stable < maxStable) {
    absorb();
    if (onProgress) onProgress(seen.size);
    const beforeCount  = seen.size;
    const beforeHeight = document.documentElement.scrollHeight;
    const beforeY      = window.scrollY;
    await smoothScrollBy(stepPx);
    await sleep(waitMs);
    absorb(); // catch rows that rendered after the scroll settled
    const grew = seen.size > beforeCount ||
                 document.documentElement.scrollHeight > beforeHeight ||
                 window.scrollY > beforeY; // still making progress down the list
    stable = grew ? 0 : stable + 1;
  }
  return [...seen.values()];
}

// ── Facebook Platform ──────────────────────────────────────────────────────

// Surface: facebook.com/pages/?category=liked — the "All Pages you follow" list.
// Each card exposes name, category, page link, and a "Following" button that
// silently toggles to "Follow" on click (no menu, no dialog). Verified live.
const Facebook = (() => {
  let _stop = false;
  let _paused = false;
  let _running = false;
  let _done = 0;

  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
  const sleepRand = (a, b) => sleep(rand(a, b));

  // Interruptible sleep: respects pause + stop. During pause, blocks; on stop,
  // returns immediately so the outer loop can exit cleanly.
  async function sleepPausable(ms) {
    const step = 300;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (_stop) return;
      if (_paused) {
        sendStatus('⏸️ Paused. Resume when ready.', _done);
        while (_paused && !_stop) await sleep(step);
        if (_stop) return;
        sendStatus(`▶️ Resumed.`, _done);
      }
      await sleep(Math.min(step, Math.max(0, deadline - Date.now())));
    }
  }
  async function pauseGate() {
    if (_paused) {
      sendStatus('⏸️ Paused. Resume when ready.', _done);
      while (_paused && !_stop) await sleep(300);
      if (!_stop) sendStatus(`▶️ Resumed.`, _done);
    }
  }

  function isValidPage() {
    return window.location.href.includes('facebook.com/pages') &&
           window.location.href.includes('category=liked');
  }

  // Walk up from a Following/Follow button to the card that also contains
  // the page name and category (2nd text line).
  function cardOf(btn) {
    let n = btn;
    for (let i = 0; i < 10 && n; i++) {
      if (n.querySelector && /follow/i.test(n.innerText) &&
          n.innerText.length > 20 && n.innerText.length < 400) return n;
      n = n.parentElement;
    }
    return null;
  }

  // Extract the numeric page id / slug so we can match a card even after DOM
  // reflows (like the group href in the groups module).
  function pageHref(card) {
    const a = card && card.querySelector('a[href*="facebook.com/"], a[href^="/"]');
    if (!a) return null;
    return a.getAttribute('href').split('?')[0];
  }

  function collectVisible() {
    const out = [];
    for (const btn of document.querySelectorAll('[aria-label="Following"]')) {
      const card = cardOf(btn);
      if (!card) continue;
      const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      const name = lines[0];
      const category = lines[1];
      const href = pageHref(card);
      if (!href || !name) continue;
      out.push({ href, name, category });
    }
    return out;
  }

  // Scan the whole list. `minDays` unused here (pages don't expose last-visited)
  // but kept for API parity with the groups scan.
  async function scan(_opts = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _done); return; }
    _running = true;
    _stop = false;
    sendStatus('🔍 Scanning your followed pages…', 0);

    let pages = [];
    try {
      pages = await scrollCollectAll({
        collect: collectVisible,
        key: p => p.href,
        onProgress: n => sendStatus(`🔍 Found ${n} pages…`, n),
        isStopped: () => _stop,
      });
    } finally {
      _running = false;
    }

    chrome.runtime.sendMessage({ target: 'popup', type: 'PAGES_LIST', pages });
    sendStatus(`✅ Scan complete — ${pages.length} pages found.`, pages.length);
  }

  // Live-lookup the "Following" button for a page href (DOM reflows as we
  // scroll and unfollow, so we never cache node refs).
  function findFollowingButton(href) {
    for (const btn of document.querySelectorAll('[aria-label="Following"]')) {
      const card = cardOf(btn);
      if (card && pageHref(card) === href) return btn;
    }
    return null;
  }

  // Unfollow one page: click Following → verify it flipped to Follow.
  async function unfollowOne(href) {
    let btn = findFollowingButton(href);
    if (!btn) {
      window.scrollBy({ top: 1000, behavior: 'smooth' });
      await sleepRand(1000, 1600);
      btn = findFollowingButton(href);
      if (!btn) return 'not-found';
    }

    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleepRand(500, 1200);
    btn.click();

    // The button's aria-label flips from Following → Follow on success.
    // (Sometimes the node itself is replaced; check both signals.)
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (!btn.isConnected) return 'ok';
      if ((btn.getAttribute('aria-label') || '').toLowerCase() === 'follow') return 'ok';
      await sleep(200);
    }
    return 'unconfirmed';
  }

  async function unfollowSelected({
    hrefs = [],
    delayMin = 1200, delayMax = 2500,   // faster than groups — no confirm dialog
    batchSize = 25,
    breakMin = 12000, breakMax = 25000,
  } = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _done); return; }
    if (!hrefs.length) { sendStatus('Nothing selected.', _done); return; }

    _running = true;
    _stop = false;
    _paused = false;
    _done = 0;
    let skipped = 0;
    let count = 0;

    sendStatus(`🚪 Unfollowing ${hrefs.length} pages…`, 0);

    try {
      for (const href of hrefs) {
        await pauseGate();
        if (_stop) { sendStatus(`⛔ Stopped — done ${_done}, skipped ${skipped}.`, _done); break; }

        const result = await unfollowOne(href);
        count++;
        chrome.runtime.sendMessage({ target: 'popup', type: 'PAGE_RESULT', href, result });
        if (result === 'ok') {
          _done++;
          sendStatus(`✅ Unfollowed ${_done}/${hrefs.length}`, _done);
        } else {
          skipped++;
          sendStatus(`⏭️ Skipped one (${result}) — done ${_done}/${hrefs.length}`, _done);
        }

        if (count >= hrefs.length) break;

        if (count % batchSize === 0) {
          const rest = rand(breakMin, breakMax);
          sendStatus(`☕ Resting ${Math.round(rest / 1000)}s…`, _done);
          await sleepPausable(rest);
        } else {
          await sleepPausable(rand(delayMin, delayMax));
        }
      }
      chrome.runtime.sendMessage({ target: 'popup', type: 'PAGES_DONE', count: _done, stopped: _stop });
      sendStatus(`${_stop ? '⛔ Stopped' : '🏁 Done'} — unfollowed ${_done}, skipped ${skipped}.`, _done);
    } finally {
      _running = false;
      _paused = false;
    }
  }

  function stop() { _stop = true; _paused = false; }
  function pause() { _paused = true; }
  function resume() { _paused = false; }

  return { name: 'Facebook', isValidPage, scan, unfollowSelected, stop, pause, resume };
})();

// ── Instagram Platform (placeholder) ──────────────────────────────────────

const Instagram = (() => {
  function isValidPage() { return window.location.href.includes('instagram.com'); }
  async function run() { sendStatus('🚧 Instagram support coming soon!'); }
  function stop() {}
  function getCount() { return 0; }
  return { name: 'Instagram', run, stop, getCount, isValidPage };
})();

// ── Twitter/X Platform (placeholder) ──────────────────────────────────────

const Twitter = (() => {
  function isValidPage() {
    return window.location.href.includes('twitter.com') ||
           window.location.href.includes('x.com');
  }
  async function run() { sendStatus('🚧 Twitter/X support coming soon!'); }
  function stop() {}
  function getCount() { return 0; }
  return { name: 'Twitter/X', run, stop, getCount, isValidPage };
})();

// ── Facebook Groups: leave joined groups ───────────────────────────────────
// Surface: facebook.com/groups/joins/ — a card grid of every group you've
// joined. Each card exposes the group name, a "You last visited …" line, and
// a "More" (⋯) button whose menu contains "Leave group" → confirm dialog.
// Selectors below were verified against live Facebook (English locale).

const FacebookGroups = (() => {
  let _stop = false;
  let _paused = false;
  let _running = false;
  let _left = 0;

  // Localized strings — centralized so other locales can be added later.
  const STR = {
    moreLabel: 'More',            // per-card ⋯ button aria-label
    leaveItem: 'leave group',     // menu item text (lowercased)
    confirmLabel: 'leave group',  // confirm-dialog button aria-label (lowercased)
    cancelLabel: 'cancel',
  };

  // Interruptible sleep and gate — respect pause + stop.
  async function sleepPausable(ms) {
    const step = 300;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (_stop) return;
      if (_paused) {
        sendStatus('⏸️ Paused. Resume when ready.', _left);
        while (_paused && !_stop) await sleep(step);
        if (_stop) return;
        sendStatus(`▶️ Resumed.`, _left);
      }
      await sleep(Math.min(step, Math.max(0, deadline - Date.now())));
    }
  }
  async function pauseGate() {
    if (_paused) {
      sendStatus('⏸️ Paused. Resume when ready.', _left);
      while (_paused && !_stop) await sleep(300);
      if (!_stop) sendStatus(`▶️ Resumed.`, _left);
    }
  }

  function isValidPage() {
    return window.location.href.includes('facebook.com/groups/joins');
  }

  // Walk up from a "More" button to the card element that holds the group
  // link and the visit text.
  function cardOf(btn) {
    let n = btn;
    for (let i = 0; i < 8 && n; i++) {
      if (n.querySelector &&
          n.querySelector('a[href*="/groups/"]') &&
          /visit/i.test(n.innerText)) return n;
      n = n.parentElement;
    }
    return null;
  }

  // "You last visited 25 weeks ago" → { raw, days } (days is approximate; null
  // when unknown so age filters can safely skip it).
  function parseVisit(text) {
    const m = text && text.match(/last visited\s+(?:(a|an|\d+)\s+)?(minute|hour|day|week|month|year)s?\s+ago/i);
    if (!m) return { raw: text || '', days: null };
    const n = m[1] === 'a' || m[1] === 'an' ? 1 : parseInt(m[1] || '1', 10);
    const unit = m[2].toLowerCase();
    const perDay = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }[unit];
    return { raw: m[0], days: n * perDay };
  }

  // Snapshot the group cards currently in the DOM.
  function collectVisible() {
    const out = [];
    const moreBtns = document.querySelectorAll(`[role="button"][aria-label="${STR.moreLabel}"]`);
    for (const btn of moreBtns) {
      const card = cardOf(btn);
      if (!card) continue;
      const link = card.querySelector('a[href*="/groups/"]');
      const href = link ? link.getAttribute('href').split('?')[0] : null;
      if (!href) continue;
      const name = (card.innerText.split('\n').map(s => s.trim()).filter(Boolean)[0]) || href;
      const visitLine = (card.innerText.match(/You last visited[^\n]*\n?[^\n]*/i) || [''])[0]
        .replace(/\s+/g, ' ').trim();
      out.push({ href, name, visit: parseVisit(visitLine) });
    }
    return out;
  }

  // Scroll the whole grid, collecting groups (deduped by href). `minDays` scopes
  // the result to groups last visited at least that long ago — the scan still
  // walks every card (Facebook has no server-side filter for this), but only
  // matching groups are kept, so the list handed back stays light.
  async function scan({ minDays = 0 } = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _left); return; }
    _running = true;
    _stop = false;
    const keep = g => minDays <= 0 || (g.visit.days != null && g.visit.days >= minDays);
    sendStatus('🔍 Scanning your groups…', 0);

    let all = [];
    try {
      // Walk the whole grid robustly (Facebook has no server-side "last visited"
      // filter, so we still see every card); filtering happens after.
      all = await scrollCollectAll({
        collect: collectVisible,
        key: g => g.href,
        onProgress: n => sendStatus(`🔍 Scanned ${n}…`, n),
        isStopped: () => _stop,
      });
    } finally {
      _running = false;
    }

    const groups = all.filter(keep).map(g => ({
      href: g.href, name: g.name, visit: g.visit.raw, days: g.visit.days
    }));
    chrome.runtime.sendMessage({ target: 'popup', type: 'GROUPS_LIST', groups });
    const scope = minDays > 0 ? ` of ${all.length}` : '';
    sendStatus(`✅ Scan complete — ${groups.length}${scope} groups.`, groups.length);
  }

  // Find the live "More" button for a given group href (DOM reflows after each
  // leave, so we always re-query rather than cache nodes).
  function findMoreButton(href) {
    const btns = document.querySelectorAll(`[role="button"][aria-label="${STR.moreLabel}"]`);
    for (const btn of btns) {
      const card = cardOf(btn);
      const link = card && card.querySelector('a[href*="/groups/"]');
      if (link && link.getAttribute('href').split('?')[0] === href) return btn;
    }
    return null;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  // Human-like jitter helpers. Real people don't act on fixed intervals, so we
  // randomize every wait — this is what keeps the pace from looking robotic.
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
  const sleepRand = (min, max) => sleep(rand(min, max));

  // Poll until `fn()` returns a truthy value (an element, or `true`), or give
  // up after `timeout`. This makes the flow event-driven instead of guessing
  // fixed delays — we only click once the menu/dialog has actually rendered.
  async function waitFor(fn, timeout = 5000, poll = 200) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (_stop) return null;
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(poll);
    }
    return null;
  }

  // Facebook's groups page always keeps one hidden [role="dialog"] in the DOM,
  // so we must NOT treat "any dialog" as an open overlay. A *blocking* overlay
  // is an open menu, or a dialog that belongs to our flow (its text mentions
  // leaving/leaving/reporting a group). Returns that element, or null.
  function openBlockingOverlay() {
    const menu = document.querySelector('[role="menu"]');
    if (menu) return menu;
    return [...document.querySelectorAll('[role="dialog"]')].find(d => {
      const t = (d.innerText || '').toLowerCase();
      // "leave group" (confirm), "left group" (post-leave title), "report this group" (body).
      return t.includes('leave group') || t.includes('left group') || t.includes('report this group');
    }) || null;
  }

  // Dismiss a leftover menu / leave-confirm / report prompt so popups never pile
  // up between groups. Closes the report prompt via its Close (X) button — never
  // a report-reason row. Falls back to Escape (which also closes menus).
  async function closeOverlays() {
    for (let i = 0; i < 6; i++) {
      const overlay = openBlockingOverlay();
      if (!overlay) return;
      if (overlay.getAttribute('role') === 'dialog') {
        // Match aria-label STARTING with "close" (e.g. "Close", "Close dialog")
        // so we don't miss it if Facebook adds trailing text. Never matches any
        // report-reason row (none of them start with "close").
        const closeBtn = [...overlay.querySelectorAll('[role="button"][aria-label]')]
          .find(b => /^close\b/i.test((b.getAttribute('aria-label') || '').trim()));
        if (closeBtn) closeBtn.click();
        else pressEscape();
      } else {
        pressEscape();
      }
      await sleepRand(300, 600);
    }
  }

  // Leave a single group: open ⋯ menu → "Leave group" → confirm dialog.
  // Returns 'ok' only when the confirm dialog actually closed (a real leave);
  // otherwise a reason string. Always cleans up open overlays on failure.
  async function leaveOne(href) {
    // Aggressive cleanup — if the previous group's dialogs are still visible
    // (e.g. screen-sleep throttling kept clicks from registering), close them
    // now. If we truly can't clear them, refuse to start rather than stack
    // more menus on top. That refusal is what triggers the auto-pause upstream.
    await closeOverlays();
    if (openBlockingOverlay()) {
      await sleepRand(500, 900);
      await closeOverlays();
      if (openBlockingOverlay()) return 'blocked-stuck';
    }

    let btn = findMoreButton(href);
    if (!btn) {
      window.scrollBy({ top: 1000, behavior: 'smooth' });
      await sleepRand(1200, 2000);
      btn = findMoreButton(href);
      if (!btn) return 'not-found';
    }

    // Bring the row into view, pause like a human reading it, then open menu.
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleepRand(900, 1800);
    btn.click();

    // Wait for the menu to render (any items), then look for "Leave group".
    const menuReady = await waitFor(() =>
      document.querySelectorAll('[role="menuitem"]').length > 0, 5000);
    if (!menuReady) { await closeOverlays(); return 'no-menu'; }

    const item = [...document.querySelectorAll('[role="menuitem"]')]
      .find(m => (m.innerText || '').trim().toLowerCase() === STR.leaveItem);
    if (!item) {
      // Menu opened but offers no "Leave group" (only Your content / Share /
      // Report group) → you're no longer a member. Already left.
      await closeOverlays();
      return 'already-left';
    }
    await sleepRand(700, 1500);
    item.click();

    // Wait for the "Leave group?" confirmation dialog and its confirm button.
    // Search across ALL open dialogs — not just the first. Facebook's groups
    // page keeps a persistent hidden [role="dialog"] in the DOM; if we only
    // looked at the first one we'd find no confirm button and (wrongly) time out.
    const confirm = await waitFor(() => {
      for (const dlg of document.querySelectorAll('[role="dialog"]')) {
        const btn = [...dlg.querySelectorAll('[role="button"]')].find(b => {
          const label = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          const text = (b.innerText || '').trim().toLowerCase();
          return label === STR.confirmLabel || text === STR.confirmLabel;
        });
        if (btn) return btn;
      }
      return null;
    }, 6000);
    if (!confirm) { await closeOverlays(); return 'no-confirm'; }
    await sleepRand(700, 1500);
    confirm.click();

    // A leave has succeeded when ANY of these signals fires:
    //   1. The confirm button we clicked has detached from the DOM.
    //   2. The group's card has vanished from the list.
    //   3. The post-leave "Left group / report this group?" popup has appeared —
    //      Facebook only shows this AFTER the leave commits, so its presence is
    //      definitive proof, even if the confirm dialog hasn't torn down yet.
    // Any one is enough; whichever fires first wins.
    const committed = await waitFor(() => {
      if (!confirm.isConnected) return 'button-gone';
      if (!findMoreButton(href)) return 'card-gone';
      // Iterate ALL dialogs — the persistent hidden one may be first in DOM.
      for (const dlg of document.querySelectorAll('[role="dialog"]')) {
        const t = (dlg.innerText || '').toLowerCase();
        if (t.includes('left group') || t.includes('report this group')) return 'left-popup';
      }
      return null;
    }, 8000);
    if (!committed) { await closeOverlays(); return 'unconfirmed'; }

    // Facebook only shows the "Left group / report this group?" popup for SOME
    // groups, and it can appear a beat after commit. Wait up to 3s for it to
    // show; if it does, close it via its X. If it doesn't, move on.
    await waitFor(() => openBlockingOverlay(), 3000, 150);
    await closeOverlays();

    // Safe fallback: if ANY dialog is somehow still open (unrecognised survey,
    // etc.), press Escape a few times. We only ever press Escape — never click
    // inside an unknown dialog — so this can't submit a report or survey answer.
    for (let i = 0; i < 5 && document.querySelector('[role="dialog"], [role="menu"]'); i++) {
      pressEscape();
      await sleepRand(300, 600);
    }

    await sleepRand(500, 1200);
    return 'ok';
  }

  // Leave every group in `hrefs`, paced to look human. Defaults aim for roughly
  // one group every ~8-15s with longer rests between batches, so Facebook's
  // automation heuristics are far less likely to flag the account.
  async function leaveSelected({
    hrefs = [],
    delayMin = 5000, delayMax = 9000,   // gap between groups
    batchSize = 10,                     // groups before a longer rest
    breakMin = 45000, breakMax = 90000  // longer rest length
  } = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _left); return; }
    if (!hrefs.length) { sendStatus('Nothing selected.', _left); return; }

    _running = true;
    _stop = false;
    _paused = false;
    _left = 0;
    let skipped = 0;
    let done = 0;
    let consecutiveStuck = 0; // auto-pause guard for stacked-popup scenarios

    sendStatus(`🚪 Leaving ${hrefs.length} groups (human-paced)…`, 0);

    try {
      for (const href of hrefs) {
        await pauseGate();
        if (_stop) { sendStatus(`⛔ Stopped — left ${_left}, skipped ${skipped}.`, _left); break; }

        const result = await leaveOne(href);
        done++;
        // Per-group log entry for the popup (it maps href → name).
        chrome.runtime.sendMessage({ target: 'popup', type: 'GROUP_RESULT', href, result });
        if (result === 'ok' || result === 'already-left') {
          _left++;
          consecutiveStuck = 0;
          sendStatus(`✅ ${result === 'already-left' ? 'Already out of' : 'Left'} ${_left}/${hrefs.length}`, _left);
        } else {
          skipped++;
          if (result === 'blocked-stuck') consecutiveStuck++;
          else consecutiveStuck = 0;
          sendStatus(`⏭️ Skipped one (${result}) — left ${_left}/${hrefs.length}`, _left);
        }

        // Auto-pause: if 3 groups in a row are blocked by un-closable popups
        // (typical after a screen-sleep throttled the tab), stop the run rather
        // than stack more menus. The user closes the popups and restarts.
        if (consecutiveStuck >= 3) {
          sendStatus(`🛑 Paused — Facebook popups aren't closing (possibly stacked after screen sleep). Close them manually, then start again.`, _left);
          _stop = true;
          break;
        }

        if (done >= hrefs.length) break;

        // Longer rest every batchSize groups; otherwise a randomized short gap.
        if (done % batchSize === 0) {
          const rest = rand(breakMin, breakMax);
          sendStatus(`☕ Resting ${Math.round(rest / 1000)}s to stay under the radar…`, _left);
          await sleepPausable(rest);
        } else {
          const gap = rand(delayMin, delayMax);
          sendStatus(`⏳ Pausing ${Math.round(gap / 1000)}s before the next one…`, _left);
          await sleepPausable(gap);
        }
      }
      // Always signal completion (finished or stopped) so the popup can wrap up.
      chrome.runtime.sendMessage({ target: 'popup', type: 'GROUPS_DONE', count: _left, stopped: _stop });
      sendStatus(`${_stop ? '⛔ Stopped' : '🏁 Done'} — left ${_left}, skipped ${skipped}.`, _left);
    } finally {
      _running = false;
      _paused = false;
    }
  }

  function stop() { _stop = true; _paused = false; }
  function pause() { _paused = true; }
  function resume() { _paused = false; }

  return { isValidPage, scan, leaveSelected, stop, pause, resume };
})();

// ── Facebook Following: unfollow people/pages from a profile's Following list
// Surface: facebook.com/USERNAME/following/ — a card grid of the 700+ profiles
// and pages this account follows. Each card exposes name, subtitle, and a ⋯
// menu whose first item is "Unfollow". Two quirks verified live:
//   1. Synthetic .click() on the ⋯ DOES NOT open the menu. A full pointer-event
//      sequence (pointerdown+mousedown+pointerup+mouseup+click) does.
//   2. The menu content is fetched async — takes 2-4s to render items.
// Verified against live Facebook 2026-07-06.

const FacebookFollowing = (() => {
  let _stop = false;
  let _paused = false;
  let _running = false;
  let _done = 0;

  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
  const sleepRand = (a, b) => sleep(rand(a, b));

  // Pause-aware sleep + gate (same pattern as the other two modules).
  async function sleepPausable(ms) {
    const step = 300;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (_stop) return;
      if (_paused) {
        sendStatus('⏸️ Paused. Resume when ready.', _done);
        while (_paused && !_stop) await sleep(step);
        if (_stop) return;
        sendStatus(`▶️ Resumed.`, _done);
      }
      await sleep(Math.min(step, Math.max(0, deadline - Date.now())));
    }
  }
  async function pauseGate() {
    if (_paused) {
      sendStatus('⏸️ Paused. Resume when ready.', _done);
      while (_paused && !_stop) await sleep(300);
      if (!_stop) sendStatus(`▶️ Resumed.`, _done);
    }
  }

  function isValidPage() {
    // Match /USERNAME/following/ but not /pages/ or /groups/
    return /facebook\.com\/[^\/]+\/following\/?(\?|$)/.test(window.location.href) &&
           !window.location.href.includes('/pages/') &&
           !window.location.href.includes('/groups/');
  }

  // Walk up from a ⋯ button until we find its card (must contain a profile/page
  // link and NOT contain an h1 — that filters out header/section ⋯ buttons).
  function cardOf(btn) {
    let n = btn;
    for (let i = 0; i < 10 && n; i++) {
      if (n.querySelector &&
          n.querySelector('a[href*="facebook.com/"], a[href^="/"]') &&
          !n.querySelector('h1') &&
          (n.innerText || '').length < 400) return n;
      n = n.parentElement;
    }
    return null;
  }

  function cardKey(card) {
    const a = card && card.querySelector('a[href*="facebook.com/"], a[href^="/"]');
    return a ? a.getAttribute('href').split('?')[0] : null;
  }

  // Facebook's Friends-section header has a "More options for friends list"
  // button that matches our pattern but is NOT a followed entity — its href is a
  // nav path like /friends/. Exclude those section/nav controls.
  const NAV_HREF = /^\/(friends|find[-_]?friends|requests|bookmarks|pages)(\/|$)/i;
  const NAV_NAME = /^(friend requests|find friends|friends|suggestions)$/i;

  function collectVisible() {
    const out = [];
    for (const btn of document.querySelectorAll('[role="button"][aria-label^="More options for"]')) {
      const r = btn.getBoundingClientRect();
      if (r.width < 5) continue;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('friends list')) continue; // the section header ⋯
      const card = cardOf(btn);
      if (!card) continue;
      const href = cardKey(card);
      if (!href) continue;
      // A real entry links to a profile/page (facebook.com/…); nav paths don't.
      if (NAV_HREF.test(href)) continue;
      const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const name = lines[0] || href;
      if (NAV_NAME.test(name)) continue;
      const subtitle = lines[1] || '';
      out.push({ href, name, subtitle });
    }
    return out;
  }

  async function scan(_opts = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _done); return; }
    _running = true;
    _stop = false;
    sendStatus('🔍 Scanning your following list…', 0);

    let list = [];
    try {
      list = await scrollCollectAll({
        collect: collectVisible,
        key: f => f.href,
        onProgress: n => sendStatus(`🔍 Found ${n}…`, n),
        isStopped: () => _stop,
      });
    } finally { _running = false; }

    chrome.runtime.sendMessage({ target: 'popup', type: 'FOLLOWING_LIST', following: list });
    sendStatus(`✅ Scan complete — ${list.length} entries found.`, list.length);
  }

  function findTriggerButton(href) {
    for (const btn of document.querySelectorAll('[role="button"][aria-label^="More options for"]')) {
      const card = cardOf(btn);
      if (card && cardKey(card) === href) return btn;
    }
    return null;
  }

  async function waitFor(fn, timeout = 6000, poll = 250) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (_stop) return null;
      let v; try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      await sleep(poll);
    }
    return null;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  // Full pointer-event sequence — plain .click() doesn't open this menu.
  function openMenuOn(btn) {
    const r = btn.getBoundingClientRect();
    const o = {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 0, pointerType: 'mouse', pointerId: 1, isPrimary: true
    };
    btn.dispatchEvent(new PointerEvent('pointerdown', o));
    btn.dispatchEvent(new MouseEvent('mousedown', o));
    btn.dispatchEvent(new PointerEvent('pointerup', o));
    btn.dispatchEvent(new MouseEvent('mouseup', o));
    btn.dispatchEvent(new MouseEvent('click', o));
  }

  async function unfollowOne(href) {
    // Best-effort cleanup — but IGNORE the persistent hidden dialog (learned from
    // groups). Only close a live menu.
    for (let i = 0; i < 3 && document.querySelector('[role="menu"]'); i++) {
      pressEscape();
      await sleepRand(300, 500);
    }

    let btn = findTriggerButton(href);
    if (!btn) {
      window.scrollBy({ top: 1000, behavior: 'smooth' });
      await sleepRand(1200, 1800);
      btn = findTriggerButton(href);
      if (!btn) return 'not-found';
    }

    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleepRand(700, 1200);
    openMenuOn(btn);

    // Menu loads async (~2-4s in testing). Wait up to 6s for the "Unfollow" item.
    const unfollowItem = await waitFor(() =>
      [...document.querySelectorAll('[role="menuitem"]')].find(m =>
        (m.innerText || '').trim().toLowerCase() === 'unfollow'), 6000);
    if (!unfollowItem) { pressEscape(); return 'no-menu'; }

    await sleepRand(500, 900);
    unfollowItem.click();

    // Definitive success signal (learned the hard way with groups): the menu
    // closes the instant FB accepts the click, which detaches the menu items
    // from the DOM. That fires reliably regardless of what appears next.
    const menuGone = await waitFor(() =>
      !unfollowItem.isConnected || !findTriggerButton(href), 7000);
    if (!menuGone) { pressEscape(); return 'unconfirmed'; }

    // Some entries pop a confirmation dialog after the menu closes. Give it a
    // beat to appear, and if it does, click through it.
    await sleepRand(400, 900);
    let confirmDlg = null;
    for (const dlg of document.querySelectorAll('[role="dialog"]')) {
      const t = (dlg.innerText || '').toLowerCase();
      if (t.length < 800 && /(^|\s)unfollow\b|stop following|confirm/i.test(t)) {
        confirmDlg = dlg; break;
      }
    }
    if (confirmDlg) {
      const confirmBtn = [...confirmDlg.querySelectorAll('[role="button"]')].find(b => {
        const t = (b.innerText || '').trim().toLowerCase();
        const l = (b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'unfollow' || t === 'confirm' || l === 'unfollow' || l === 'confirm';
      });
      if (confirmBtn) {
        await sleepRand(500, 900);
        confirmBtn.click();
        await waitFor(() => !confirmBtn.isConnected, 5000);
      }
    }

    // Cleanup any leftover popups (post-unfollow prompts, etc.)
    for (let i = 0; i < 3 && document.querySelector('[role="menu"]'); i++) {
      pressEscape();
      await sleepRand(300, 500);
    }
    await sleepRand(500, 1000);
    return 'ok';
  }

  async function unfollowSelected({
    hrefs = [],
    delayMin = 3000, delayMax = 6000,     // human pacing between entries
    batchSize = 15,
    breakMin = 30000, breakMax = 60000
  } = {}) {
    if (_running) { sendStatus('⚠️ Already busy.', _done); return; }
    if (!hrefs.length) { sendStatus('Nothing selected.', _done); return; }
    _running = true;
    _stop = false;
    _paused = false;
    _done = 0;
    let skipped = 0;
    let count = 0;
    sendStatus(`🚪 Unfollowing ${hrefs.length}…`, 0);

    try {
      for (const href of hrefs) {
        await pauseGate();
        if (_stop) { sendStatus(`⛔ Stopped — ${_done} done, ${skipped} skipped.`, _done); break; }
        const result = await unfollowOne(href);
        count++;
        chrome.runtime.sendMessage({ target: 'popup', type: 'FOLLOWING_RESULT', href, result });
        if (result === 'ok') {
          _done++;
          sendStatus(`✅ Unfollowed ${_done}/${hrefs.length}`, _done);
        } else {
          skipped++;
          sendStatus(`⏭️ Skipped (${result}) — ${_done}/${hrefs.length}`, _done);
        }
        if (count >= hrefs.length) break;
        if (count % batchSize === 0) {
          const rest = rand(breakMin, breakMax);
          sendStatus(`☕ Resting ${Math.round(rest / 1000)}s…`, _done);
          await sleepPausable(rest);
        } else {
          await sleepPausable(rand(delayMin, delayMax));
        }
      }
      chrome.runtime.sendMessage({ target: 'popup', type: 'FOLLOWING_DONE', count: _done, stopped: _stop });
      sendStatus(`${_stop ? '⛔ Stopped' : '🏁 Done'} — ${_done} unfollowed, ${skipped} skipped.`, _done);
    } finally { _running = false; _paused = false; }
  }

  function stop() { _stop = true; _paused = false; }
  function pause() { _paused = true; }
  function resume() { _paused = false; }

  return { name: 'Facebook', isValidPage, scan, unfollowSelected, stop, pause, resume };
})();

// ── Platform registry ──────────────────────────────────────────────────────

const platforms = [Facebook, Instagram, Twitter];

function detectPlatform() {
  return platforms.find(p => p.isValidPage()) || null;
}

// ── Message listener ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'content') return;

  const platform = detectPlatform();
  // Groups and Following are distinct Facebook surfaces with their own URL and
  // flow — they're not in the platform registry. Detection order matters:
  // check them BEFORE the generic pages platform.
  const groupsMode    = FacebookGroups.isValidPage();
  const followingMode = FacebookFollowing.isValidPage();

  switch (message.type) {

    case 'DETECT':
      sendResponse({
        detected: groupsMode || followingMode || !!platform,
        platformName: (groupsMode || followingMode) ? 'Facebook' : (platform?.name || null),
        mode: groupsMode ? 'groups' : followingMode ? 'following' : (platform ? 'pages' : null)
      });
      break;

    case 'STOP':
      if (groupsMode) FacebookGroups.stop();
      else if (followingMode) FacebookFollowing.stop();
      else if (platform && platform.stop) platform.stop();
      sendResponse({ ok: true });
      break;

    case 'PAUSE':
      if (groupsMode) FacebookGroups.pause();
      else if (followingMode) FacebookFollowing.pause();
      else if (platform && platform.pause) platform.pause();
      sendResponse({ ok: true });
      break;

    case 'RESUME':
      if (groupsMode) FacebookGroups.resume();
      else if (followingMode) FacebookFollowing.resume();
      else if (platform && platform.resume) platform.resume();
      sendResponse({ ok: true });
      break;

    // ── Pages: scan + unfollow selected ──
    case 'PAGES_SCAN':
      if (platform && platform.scan) platform.scan(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'PAGES_UNFOLLOW':
      if (platform && platform.unfollowSelected) platform.unfollowSelected(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'PAGES_STOP':
      if (platform && platform.stop) platform.stop();
      sendResponse({ ok: true });
      break;

    // ── Following: scan + unfollow selected ──
    case 'FOLLOWING_SCAN':
      FacebookFollowing.scan(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'FOLLOWING_UNFOLLOW':
      FacebookFollowing.unfollowSelected(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'FOLLOWING_STOP':
      FacebookFollowing.stop();
      sendResponse({ ok: true });
      break;

    // ── Groups leave flow ──
    case 'GROUPS_SCAN':
      FacebookGroups.scan(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'GROUPS_LEAVE':
      FacebookGroups.leaveSelected(message.options || {});
      sendResponse({ ok: true });
      break;

    case 'GROUPS_STOP':
      FacebookGroups.stop();
      sendResponse({ ok: true });
      break;
  }

  return true;
});
