/**
 * Social Cleaner - Popup Controller
 * Routes between two Facebook actions depending on the page:
 *   • Pages mode  — unfollow liked pages (facebook.com/pages/?category=liked)
 *   • Groups mode — leave joined groups (facebook.com/groups/joins)
 */

// Show version from manifest so it can never drift from the HTML
document.getElementById('version').textContent =
  'v' + chrome.runtime.getManifest().version;

// ── Shared DOM refs ──────────────────────────────────────────────────────────
const counter       = document.getElementById('counter');
const counterLabel  = document.getElementById('counter-label');
const statusEl      = document.getElementById('status');
const pagesPanel    = document.getElementById('pages-panel');
const groupsPanel   = document.getElementById('groups-panel');

// Screens (tabs + picker + coming-soon + wrong-url + feature)
const screenPicker    = document.getElementById('screen-picker');
const screenComingSoon= document.getElementById('screen-coming-soon');
const screenWrongUrl  = document.getElementById('screen-wrong-url');
const screenFeature   = document.getElementById('screen-feature');
const comingSoonLabel = document.getElementById('coming-soon-platform');
const comingSoonIcon  = document.getElementById('coming-soon-icon');
const btnBackToFb     = document.getElementById('btn-back-to-fb');
const wrongUrlFeature = document.getElementById('wrong-url-feature');
const wrongUrlTarget  = document.getElementById('wrong-url-target');
const btnNavToFeature = document.getElementById('btn-nav-to-feature');
const btnWrongUrlBack = document.getElementById('btn-wrong-url-back');
const btnBackToPicker = document.getElementById('btn-back-to-picker');
const activeFeatLabel = document.getElementById('active-feature-label');

// Facebook feature URLs — verified live
const FEATURE_URLS = {
  pages:     'https://www.facebook.com/pages/?category=liked&ref=bookmarks',
  groups:    'https://www.facebook.com/groups/joins/',
  following: 'https://www.facebook.com/me/following/',
};
const FEATURE_LABELS = {
  pages: 'Pages',
  groups: 'Groups',
  following: 'Following',
};

// Coming-soon copy per platform
const PLATFORM_META = {
  facebook:  { label: 'Facebook',  icon: '📘' },
  instagram: { label: 'Instagram', icon: '📷' },
  twitter:   { label: 'X / Twitter', icon: '𝕏' },
  linkedin:  { label: 'LinkedIn',  icon: '💼' },
};

// Pages-mode refs (new scan/filter/unfollow flow)
const pagesScanStep     = document.getElementById('pages-scan-step');
const pagesReviewStep   = document.getElementById('pages-review-step');
const pagesConfirmStep  = document.getElementById('pages-confirm-step');
const pagesRunningStep  = document.getElementById('pages-running-step');
const btnPagesScan      = document.getElementById('btn-pages-scan');
const pagesSearch       = document.getElementById('pages-search');
const pagesChipsEl      = document.getElementById('pages-chips');
const btnChipsClear     = document.getElementById('btn-chips-clear');
const pagesSelAll       = document.getElementById('pages-selectall');
const pagesListEl       = document.getElementById('pages-list');
const btnPagesUnfollow  = document.getElementById('btn-pages-unfollow');
const pagesConfirmCount = document.getElementById('pages-confirm-count');
const btnPagesConfirmGo = document.getElementById('btn-pages-confirm-go');
const btnPagesConfirmNo = document.getElementById('btn-pages-confirm-cancel');
const btnPagesStop      = document.getElementById('btn-pages-stop');
const btnPagesPause     = document.getElementById('btn-pages-pause');
const btnPagesResume    = document.getElementById('btn-pages-resume');
const btnPagesDone      = document.getElementById('btn-pages-done');
const pagesRunSummary   = document.getElementById('pages-run-summary');
const pagesLogEl        = document.getElementById('pages-log');

// Following-mode refs
const followingPanel       = document.getElementById('following-panel');
const followingScanStep    = document.getElementById('following-scan-step');
const followingReviewStep  = document.getElementById('following-review-step');
const followingConfirmStep = document.getElementById('following-confirm-step');
const followingRunningStep = document.getElementById('following-running-step');
const btnFollowingScan     = document.getElementById('btn-following-scan');
const followingSearch      = document.getElementById('following-search');
const followingSelAll      = document.getElementById('following-selectall');
const followingListEl      = document.getElementById('following-list');
const btnFollowingUnfollow = document.getElementById('btn-following-unfollow');
const followingConfirmCount= document.getElementById('following-confirm-count');
const btnFollowingConfirmGo= document.getElementById('btn-following-confirm-go');
const btnFollowingConfirmNo= document.getElementById('btn-following-confirm-cancel');
const btnFollowingStop     = document.getElementById('btn-following-stop');
const btnFollowingPause    = document.getElementById('btn-following-pause');
const btnFollowingResume   = document.getElementById('btn-following-resume');
const btnFollowingDone     = document.getElementById('btn-following-done');
const followingRunSummary  = document.getElementById('following-run-summary');
const followingLogEl       = document.getElementById('following-log');

// Groups-mode refs
const scanStep      = document.getElementById('groups-scan-step');
const reviewStep    = document.getElementById('groups-review-step');
const confirmStep   = document.getElementById('groups-confirm-step');
const runningStep   = document.getElementById('groups-running-step');
const btnScan       = document.getElementById('btn-scan');
const scanFilter    = document.getElementById('scan-filter');
const groupsFilter  = document.getElementById('groups-filter');
const groupsSearch  = document.getElementById('groups-search');
const groupsSelAll  = document.getElementById('groups-selectall');
const groupsListEl  = document.getElementById('groups-list');
const btnLeave      = document.getElementById('btn-leave');
const confirmCount  = document.getElementById('confirm-count');
const btnConfirmGo  = document.getElementById('btn-confirm-leave');
const btnConfirmNo  = document.getElementById('btn-confirm-cancel');
const btnGroupsStop = document.getElementById('btn-groups-stop');
const btnGroupsPause  = document.getElementById('btn-groups-pause');
const btnGroupsResume = document.getElementById('btn-groups-resume');
const btnGroupsDone = document.getElementById('btn-groups-done');
const groupsLogEl   = document.getElementById('groups-log');
const runSummary    = document.getElementById('run-summary');

// ── Helpers ──────────────────────────────────────────────────────────────────
function setStatus(msg) { statusEl.textContent = msg; }
function setCounter(n)  { counter.textContent = n; }

// ── Screen state machine ────────────────────────────────────────────────────
// Screens: 'picker' | 'coming-soon' | 'wrong-url' | 'feature'
// currentPlatform: 'facebook' | 'instagram' | 'twitter' | 'linkedin'
// currentFeature: 'pages' | 'groups' | 'following' | null
let currentPlatform = 'facebook';
let currentFeature  = null;

function showScreen(name) {
  for (const [el, n] of [
    [screenPicker,     'picker'],
    [screenComingSoon, 'coming-soon'],
    [screenWrongUrl,   'wrong-url'],
    [screenFeature,    'feature'],
  ]) el.classList.toggle('hidden', n !== name);
}

function highlightPlatformTab(platform) {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.platform === platform);
  }
}

// URL check without pinging the content script — used when user picks a feature
// so we don't need a live content script to make the routing decision.
function urlMatchesFeature(url, feature) {
  if (!url) return false;
  if (feature === 'pages')     return url.includes('facebook.com/pages') && url.includes('category=liked');
  if (feature === 'groups')    return url.includes('facebook.com/groups/joins');
  if (feature === 'following') return /facebook\.com\/[^\/]+\/following\/?/.test(url) &&
                                       !url.includes('/pages/') && !url.includes('/groups/');
  return false;
}

async function currentTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

async function navigateActiveTab(url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.tabs.update(tab.id, { url });
}

// User picked a Facebook feature from the picker. If the tab is already there,
// jump straight to the feature panel. If not, show the "Take me there" screen.
async function selectFeature(feature) {
  currentFeature = feature;
  const url = await currentTabUrl();
  if (urlMatchesFeature(url, feature)) {
    revealFeaturePanel(feature);
  } else {
    // Wrong-URL screen
    wrongUrlFeature.textContent = FEATURE_LABELS[feature] || feature;
    wrongUrlTarget.textContent = FEATURE_URLS[feature];
    btnNavToFeature.dataset.target = FEATURE_URLS[feature];
    showScreen('wrong-url');
  }
}

// Reveal a specific feature panel (Pages / Groups / Following) inside the
// feature screen. Runs are preserved even if user was on a different feature.
function revealFeaturePanel(feature) {
  pagesPanel.classList.add('hidden');
  groupsPanel.classList.add('hidden');
  followingPanel.classList.add('hidden');

  activeFeatLabel.textContent = FEATURE_LABELS[feature];

  if (feature === 'pages') {
    counterLabel.textContent = 'unfollowed';
    pagesPanel.classList.remove('hidden');
    if (!document.querySelector('#pages-panel > div:not(.hidden)')) showPagesStep('scan');
    setStatus('Ready. Scan your pages to begin.');
  } else if (feature === 'groups') {
    counterLabel.textContent = 'left';
    groupsPanel.classList.remove('hidden');
    if (!document.querySelector('#groups-panel > div:not(.hidden)')) showGroupsStep('scan');
    setStatus('Ready. Scan your groups to begin.');
  } else if (feature === 'following') {
    counterLabel.textContent = 'unfollowed';
    followingPanel.classList.remove('hidden');
    if (!document.querySelector('#following-panel > div:not(.hidden)')) showFollowingStep('scan');
    setStatus('Ready. Scan your following list to begin.');
  }
  showScreen('feature');
}

// User picked a platform tab.
function selectPlatform(platform) {
  currentPlatform = platform;
  highlightPlatformTab(platform);
  if (platform === 'facebook') {
    // Back to the feature picker (or, if a feature is already selected AND the
    // tab URL still matches, jump back into that flow).
    if (currentFeature) {
      currentTabUrl().then(url => {
        if (urlMatchesFeature(url, currentFeature)) revealFeaturePanel(currentFeature);
        else showScreen('picker');
      });
    } else {
      showScreen('picker');
    }
  } else {
    // Coming soon splash
    const meta = PLATFORM_META[platform];
    comingSoonLabel.textContent = meta.label;
    comingSoonIcon.textContent = meta.icon;
    showScreen('coming-soon');
  }
}

// Platform tab clicks
for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => selectPlatform(btn.dataset.platform));
}

// Feature picker clicks
for (const btn of document.querySelectorAll('.feature-btn')) {
  btn.addEventListener('click', () => selectFeature(btn.dataset.feature));
}

// Back / navigate handlers
btnBackToPicker.addEventListener('click', () => {
  currentFeature = null;
  selectPlatform('facebook');
});
btnBackToFb.addEventListener('click', () => selectPlatform('facebook'));
btnWrongUrlBack.addEventListener('click', () => {
  currentFeature = null;
  selectPlatform('facebook');
});
btnNavToFeature.addEventListener('click', () => {
  const target = btnNavToFeature.dataset.target;
  if (target) navigateActiveTab(target);
});

// Send a command to the content script. `onFail` runs if the content script
// isn't reachable (wrong page, or a tab not reloaded after an extension update).
function sendToContent(type, extra = {}, onFail) {
  chrome.runtime.sendMessage({ target: 'content', type, ...extra }, (response) => {
    // Swallow the popup→runtime lastError; background now always responds.
    if (chrome.runtime.lastError) { if (onFail) onFail(); return; }
    if (response && response.error) { if (onFail) onFail(response.error); }
  });
}

// Shown when a command can't reach the page's content script.
function notReadyMessage() {
  setStatus('⚠️ This page isn\'t ready — reload the Facebook tab (⌘R / Ctrl+R), then try again.');
  sidePanelBusy = false;
}

// ════════════════════════════════════════════════════════════════════════════
// PAGES MODE — scan → filter (category + keyword) → confirm → unfollow
// Mirrors the Groups architecture.
// ════════════════════════════════════════════════════════════════════════════
let pagesData = [];             // [{ href, name, category }]
const pagesSelected = new Set(); // hrefs the user wants to unfollow
const activeCats = new Set();    // selected category filters (OR match)
let pagesRunDone = 0, pagesRunSkipped = 0;

const PAGE_RESULT_TEXT = {
  ok: 'unfollowed',
  'not-found': 'skipped — not on screen (virtualization)',
  unconfirmed: 'skipped — click didn\'t register',
};

function showPagesStep(name) {
  for (const [el, n] of [
    [pagesScanStep, 'scan'], [pagesReviewStep, 'review'],
    [pagesConfirmStep, 'confirm'], [pagesRunningStep, 'running']
  ]) el.classList.toggle('hidden', n !== name);
}

function visiblePages() {
  const terms = pagesSearch.value.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return pagesData.filter(p => {
    if (activeCats.size && !activeCats.has(p.category)) return false;
    if (terms.length && !terms.some(t => p.name.toLowerCase().includes(t))) return false;
    return true;
  });
}

function updateUnfollowBtn() {
  btnPagesUnfollow.textContent = `Unfollow selected (${pagesSelected.size})`;
  btnPagesUnfollow.disabled = pagesSelected.size === 0;
}

function renderChips() {
  const counts = new Map();
  for (const p of pagesData) counts.set(p.category, (counts.get(p.category) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  pagesChipsEl.innerHTML = '';
  for (const [cat, n] of sorted) {
    const chip = document.createElement('button');
    chip.className = 'chip' + (activeCats.has(cat) ? ' chip-on' : '');
    chip.textContent = `${cat} (${n})`;
    chip.addEventListener('click', () => {
      if (activeCats.has(cat)) activeCats.delete(cat); else activeCats.add(cat);
      renderChips();
      renderPages();
    });
    pagesChipsEl.appendChild(chip);
  }
}

function renderPages() {
  const rows = visiblePages();
  pagesListEl.innerHTML = '';
  if (!rows.length) {
    pagesListEl.innerHTML = '<p class="hint">No pages match this filter.</p>';
  }
  for (const p of rows) {
    const row = document.createElement('label');
    row.className = 'group-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = pagesSelected.has(p.href);
    cb.addEventListener('change', () => {
      if (cb.checked) pagesSelected.add(p.href); else pagesSelected.delete(p.href);
      updateUnfollowBtn();
      syncPagesSelectAll();
    });
    const info = document.createElement('div');
    info.className = 'group-info';
    const nm = document.createElement('div');
    nm.className = 'group-name';
    nm.textContent = p.name;
    const vt = document.createElement('div');
    vt.className = 'group-visit';
    vt.textContent = p.category || '';
    info.append(nm, vt);
    row.append(cb, info);
    pagesListEl.append(row);
  }
  updateUnfollowBtn();
  syncPagesSelectAll();
}

function syncPagesSelectAll() {
  const rows = visiblePages();
  pagesSelAll.checked = rows.length > 0 && rows.every(p => pagesSelected.has(p.href));
}

btnPagesScan.addEventListener('click', () => {
  setStatus('🔍 Scanning your followed pages…');
  btnPagesScan.disabled = true;
  sidePanelBusy = true;
  sendToContent('PAGES_SCAN', {}, () => { btnPagesScan.disabled = false; notReadyMessage(); });
});

pagesSearch.addEventListener('input', renderPages);

pagesSelAll.addEventListener('change', () => {
  const rows = visiblePages();
  if (pagesSelAll.checked) rows.forEach(p => pagesSelected.add(p.href));
  else rows.forEach(p => pagesSelected.delete(p.href));
  renderPages();
});

btnChipsClear.addEventListener('click', () => {
  activeCats.clear();
  renderChips();
  renderPages();
});

btnPagesUnfollow.addEventListener('click', () => {
  if (!pagesSelected.size) return;
  pagesConfirmCount.textContent = pagesSelected.size;
  showPagesStep('confirm');
});

btnPagesConfirmNo.addEventListener('click', () => showPagesStep('review'));

btnPagesConfirmGo.addEventListener('click', () => {
  pagesRunDone = 0; pagesRunSkipped = 0;
  pagesLogEl.innerHTML = '';
  pagesRunSummary.textContent = `0 / ${pagesSelected.size}`;
  btnPagesStop.classList.remove('hidden');
  btnPagesPause.classList.remove('hidden');
  btnPagesResume.classList.add('hidden');
  btnPagesDone.classList.add('hidden');
  showPagesStep('running');
  sidePanelBusy = true;
  runActive = true;
  setCounter(0);
  setStatus(`🚪 Unfollowing ${pagesSelected.size} pages…`);
  sendToContent('PAGES_UNFOLLOW', { options: { hrefs: [...pagesSelected] } },
    () => { runActive = false; showPagesStep('review'); notReadyMessage(); });
});

btnPagesStop.addEventListener('click', () => {
  setStatus('⛔ Stopping…');
  sendToContent('PAGES_STOP');
});
btnPagesPause.addEventListener('click', () => {
  togglePauseUI(btnPagesPause, btnPagesResume, true);
  sendToContent('PAUSE');
});
btnPagesResume.addEventListener('click', () => {
  togglePauseUI(btnPagesPause, btnPagesResume, false);
  sendToContent('RESUME');
});
btnPagesDone.addEventListener('click', () => {
  showPagesStep('scan');
  setStatus('Ready. Scan your pages to begin.');
});

function appendPagesLog(href, result) {
  const isOk = result === 'ok';
  if (isOk) pagesRunDone++; else pagesRunSkipped++;
  pagesRunSummary.textContent = `✅ ${pagesRunDone} unfollowed · ⏭️ ${pagesRunSkipped} skipped`;
  const p = pagesData.find(x => x.href === href);
  const name = p ? p.name : href;
  const row = document.createElement('div');
  row.className = 'log-row ' + (isOk ? 'log-ok' : 'log-skip');
  row.innerHTML = `<span class="log-icon">${isOk ? '✅' : '⏭️'}</span>
    <div class="log-text">
      <div class="log-name">${escapeHtml(name)}</div>
      ${isOk ? '' : `<div class="log-why">${escapeHtml(PAGE_RESULT_TEXT[result] || result)}</div>`}
    </div>`;
  pagesLogEl.appendChild(row);
  pagesLogEl.scrollTop = pagesLogEl.scrollHeight;
}

// ════════════════════════════════════════════════════════════════════════════
// FOLLOWING MODE — scan → filter (keyword) → confirm → unfollow
// Same architecture as Pages, no category chips (Following list doesn't expose
// a category per row).
// ════════════════════════════════════════════════════════════════════════════
let followingData = [];              // [{ href, name, subtitle }]
const followingSelected = new Set();
let followingRunDone = 0, followingRunSkipped = 0;

const FOLLOWING_RESULT_TEXT = {
  ok: 'unfollowed',
  'not-found': 'skipped — not on screen (virtualization)',
  'no-menu': 'skipped — menu didn\'t open',
  'no-confirm': 'skipped — dialog appeared but no confirm button found',
  unconfirmed: 'skipped — couldn\'t confirm the unfollow',
};

function showFollowingStep(name) {
  for (const [el, n] of [
    [followingScanStep, 'scan'], [followingReviewStep, 'review'],
    [followingConfirmStep, 'confirm'], [followingRunningStep, 'running']
  ]) el.classList.toggle('hidden', n !== name);
}

function visibleFollowing() {
  const terms = followingSearch.value.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!terms.length) return followingData;
  return followingData.filter(f => terms.some(t => f.name.toLowerCase().includes(t)));
}

function updateFollowingUnfollowBtn() {
  btnFollowingUnfollow.textContent = `Unfollow selected (${followingSelected.size})`;
  btnFollowingUnfollow.disabled = followingSelected.size === 0;
}

function renderFollowing() {
  const rows = visibleFollowing();
  followingListEl.innerHTML = '';
  if (!rows.length) {
    followingListEl.innerHTML = '<p class="hint">No entries match this filter.</p>';
  }
  for (const f of rows) {
    const row = document.createElement('label');
    row.className = 'group-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = followingSelected.has(f.href);
    cb.addEventListener('change', () => {
      if (cb.checked) followingSelected.add(f.href); else followingSelected.delete(f.href);
      updateFollowingUnfollowBtn();
      syncFollowingSelectAll();
    });
    const info = document.createElement('div');
    info.className = 'group-info';
    const nm = document.createElement('div');
    nm.className = 'group-name';
    nm.textContent = f.name;
    const vt = document.createElement('div');
    vt.className = 'group-visit';
    vt.textContent = f.subtitle || '';
    info.append(nm, vt);
    row.append(cb, info);
    followingListEl.append(row);
  }
  updateFollowingUnfollowBtn();
  syncFollowingSelectAll();
}

function syncFollowingSelectAll() {
  const rows = visibleFollowing();
  followingSelAll.checked = rows.length > 0 && rows.every(f => followingSelected.has(f.href));
}

btnFollowingScan.addEventListener('click', () => {
  setStatus('🔍 Scanning your following list…');
  btnFollowingScan.disabled = true;
  sidePanelBusy = true;
  sendToContent('FOLLOWING_SCAN', {}, () => { btnFollowingScan.disabled = false; notReadyMessage(); });
});

followingSearch.addEventListener('input', renderFollowing);

followingSelAll.addEventListener('change', () => {
  const rows = visibleFollowing();
  if (followingSelAll.checked) rows.forEach(f => followingSelected.add(f.href));
  else rows.forEach(f => followingSelected.delete(f.href));
  renderFollowing();
});

btnFollowingUnfollow.addEventListener('click', () => {
  if (!followingSelected.size) return;
  followingConfirmCount.textContent = followingSelected.size;
  showFollowingStep('confirm');
});

btnFollowingConfirmNo.addEventListener('click', () => showFollowingStep('review'));

btnFollowingConfirmGo.addEventListener('click', () => {
  followingRunDone = 0; followingRunSkipped = 0;
  followingLogEl.innerHTML = '';
  followingRunSummary.textContent = `0 / ${followingSelected.size}`;
  btnFollowingStop.classList.remove('hidden');
  btnFollowingPause.classList.remove('hidden');
  btnFollowingResume.classList.add('hidden');
  btnFollowingDone.classList.add('hidden');
  showFollowingStep('running');
  sidePanelBusy = true;
  runActive = true;
  setCounter(0);
  setStatus(`🚪 Unfollowing ${followingSelected.size} entries…`);
  sendToContent('FOLLOWING_UNFOLLOW', { options: { hrefs: [...followingSelected] } },
    () => { runActive = false; showFollowingStep('review'); notReadyMessage(); });
});

btnFollowingStop.addEventListener('click', () => {
  setStatus('⛔ Stopping…');
  sendToContent('FOLLOWING_STOP');
});
btnFollowingPause.addEventListener('click', () => {
  togglePauseUI(btnFollowingPause, btnFollowingResume, true);
  sendToContent('PAUSE');
});
btnFollowingResume.addEventListener('click', () => {
  togglePauseUI(btnFollowingPause, btnFollowingResume, false);
  sendToContent('RESUME');
});
btnFollowingDone.addEventListener('click', () => {
  showFollowingStep('scan');
  setStatus('Ready. Scan your following list to begin.');
});

function appendFollowingLog(href, result) {
  const isOk = result === 'ok';
  if (isOk) followingRunDone++; else followingRunSkipped++;
  followingRunSummary.textContent = `✅ ${followingRunDone} unfollowed · ⏭️ ${followingRunSkipped} skipped`;
  const f = followingData.find(x => x.href === href);
  const name = f ? f.name : href;
  const row = document.createElement('div');
  row.className = 'log-row ' + (isOk ? 'log-ok' : 'log-skip');
  row.innerHTML = `<span class="log-icon">${isOk ? '✅' : '⏭️'}</span>
    <div class="log-text">
      <div class="log-name">${escapeHtml(name)}</div>
      ${isOk ? '' : `<div class="log-why">${escapeHtml(FOLLOWING_RESULT_TEXT[result] || result)}</div>`}
    </div>`;
  followingLogEl.appendChild(row);
  followingLogEl.scrollTop = followingLogEl.scrollHeight;
}

// ════════════════════════════════════════════════════════════════════════════
// GROUPS MODE
// ════════════════════════════════════════════════════════════════════════════
let groupsData = [];            // [{ href, name, visit, days }]
const selected = new Set();     // hrefs the user wants to leave
let runLeft = 0, runSkipped = 0;

// Map a content-script result code to human-readable text.
const RESULT_TEXT = {
  ok: 'left',
  'already-left': 'already left (no longer a member)',
  'no-confirm': 'skipped — confirm dialog didn\'t appear',
  'no-menu': 'skipped — menu didn\'t open',
  'not-found': 'skipped — not on screen (scroll/virtualized)',
  'blocked-stuck': 'skipped — old popup stuck; couldn\'t open a new one',
  unconfirmed: 'skipped — leave didn\'t confirm in time (may have succeeded)'
};

function nameForHref(href) {
  const g = groupsData.find(x => x.href === href);
  return g ? g.name : href;
}

function appendLog(href, result) {
  const isLeft = result === 'ok' || result === 'already-left';
  if (isLeft) runLeft++; else runSkipped++;
  runSummary.textContent = `✅ ${runLeft} left · ⏭️ ${runSkipped} skipped`;

  const row = document.createElement('div');
  row.className = 'log-row ' + (isLeft ? 'log-ok' : 'log-skip');
  const icon = document.createElement('span');
  icon.className = 'log-icon';
  icon.textContent = result === 'ok' ? '✅' : (result === 'already-left' ? '☑️' : '⏭️');
  const text = document.createElement('div');
  text.className = 'log-text';
  const nm = document.createElement('div');
  nm.className = 'log-name';
  nm.textContent = nameForHref(href);
  text.appendChild(nm);
  if (result !== 'ok') {
    const why = document.createElement('div');
    why.className = 'log-why';
    why.textContent = RESULT_TEXT[result] || ('skipped — ' + result);
    text.appendChild(why);
  }
  row.append(icon, text);
  groupsLogEl.appendChild(row);
  groupsLogEl.scrollTop = groupsLogEl.scrollHeight; // keep latest in view
}

function showGroupsStep(name) {
  for (const [el, n] of [[scanStep,'scan'],[reviewStep,'review'],[confirmStep,'confirm'],[runningStep,'running']]) {
    el.classList.toggle('hidden', n !== name);
  }
}

function visibleGroups() {
  const threshold = parseInt(groupsFilter.value) || 0;
  // Comma-separated keywords, OR-matched against the group name (case-insensitive).
  const terms = groupsSearch.value.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  return groupsData.filter(g => {
    if (threshold && !(g.days != null && g.days >= threshold)) return false;
    if (terms.length && !terms.some(t => g.name.toLowerCase().includes(t))) return false;
    return true;
  });
}

function updateLeaveButton() {
  btnLeave.textContent = `Leave selected (${selected.size})`;
  btnLeave.disabled = selected.size === 0;
}

function renderGroups() {
  const rows = visibleGroups();
  groupsListEl.innerHTML = '';
  if (!rows.length) {
    groupsListEl.innerHTML = '<p class="hint">No groups match this filter.</p>';
  }
  for (const g of rows) {
    const row = document.createElement('label');
    row.className = 'group-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(g.href);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(g.href); else selected.delete(g.href);
      updateLeaveButton();
      syncSelectAll();
    });
    const info = document.createElement('div');
    info.className = 'group-info';
    const nm = document.createElement('div');
    nm.className = 'group-name';
    nm.textContent = g.name;
    const vt = document.createElement('div');
    vt.className = 'group-visit';
    vt.textContent = g.visit || 'last visit unknown';
    info.append(nm, vt);
    row.append(cb, info);
    groupsListEl.append(row);
  }
  updateLeaveButton();
  syncSelectAll();
}

function syncSelectAll() {
  const rows = visibleGroups();
  groupsSelAll.checked = rows.length > 0 && rows.every(g => selected.has(g.href));
}

btnScan.addEventListener('click', () => {
  setStatus('🔍 Scanning… this walks your whole list, so it can take a moment.');
  btnScan.disabled = true;
  sidePanelBusy = true;
  sendToContent('GROUPS_SCAN', { options: { minDays: parseInt(scanFilter.value) || 0 } },
    () => { btnScan.disabled = false; notReadyMessage(); });
});

groupsFilter.addEventListener('change', renderGroups);
groupsSearch.addEventListener('input', renderGroups);

groupsSelAll.addEventListener('change', () => {
  const rows = visibleGroups();
  if (groupsSelAll.checked) rows.forEach(g => selected.add(g.href));
  else rows.forEach(g => selected.delete(g.href));
  renderGroups();
});

btnLeave.addEventListener('click', () => {
  if (!selected.size) return;
  confirmCount.textContent = selected.size;
  showGroupsStep('confirm');
});

btnConfirmNo.addEventListener('click', () => showGroupsStep('review'));

btnConfirmGo.addEventListener('click', () => {
  runLeft = 0; runSkipped = 0;
  groupsLogEl.innerHTML = '';
  runSummary.textContent = `0 / ${selected.size}`;
  btnGroupsStop.classList.remove('hidden');
  btnGroupsPause.classList.remove('hidden');
  btnGroupsResume.classList.add('hidden');
  btnGroupsDone.classList.add('hidden');
  showGroupsStep('running');
  sidePanelBusy = true;
  runActive = true;
  setCounter(0);
  setStatus(`🚪 Leaving ${selected.size} groups…`);
  sendToContent('GROUPS_LEAVE', { options: { hrefs: [...selected] } },
    () => { runActive = false; showGroupsStep('review'); notReadyMessage(); });
});

btnGroupsDone.addEventListener('click', () => {
  showGroupsStep('scan');
  setStatus('Ready. Scan your groups to begin.');
});

btnGroupsStop.addEventListener('click', () => {
  setStatus('⛔ Stopping after current group…');
  sendToContent('GROUPS_STOP');
});

// Pause/Resume toggle helper — swaps which button is visible.
function togglePauseUI(pauseBtn, resumeBtn, paused) {
  pauseBtn.classList.toggle('hidden', paused);
  resumeBtn.classList.toggle('hidden', !paused);
}

btnGroupsPause.addEventListener('click', () => {
  togglePauseUI(btnGroupsPause, btnGroupsResume, true);
  sendToContent('PAUSE');
});
btnGroupsResume.addEventListener('click', () => {
  togglePauseUI(btnGroupsPause, btnGroupsResume, false);
  sendToContent('RESUME');
});

// ════════════════════════════════════════════════════════════════════════════
// Detection — chooses the right panel for the active tab. Re-runs when you
// switch tabs (side panel persists across tabs, unlike the old popup).
// A run in progress (scan or leave) is NOT disrupted by re-detection: we only
// swap panels when the side panel is idle.
// ════════════════════════════════════════════════════════════════════════════
let sidePanelBusy = false; // true while a scan or leave is in progress
let runActive = false;     // true ONLY during an unfollow/leave run (not scan),
                           // so scan progress never drives the big counter

// ── Initial routing on load ─────────────────────────────────────────────────
// If the active tab is already on a supported Facebook URL, jump straight into
// that feature. Otherwise show the picker. Users navigate manually from there
// via the platform tabs, feature buttons, and back links.
async function initialRoute() {
  const url = await currentTabUrl();
  highlightPlatformTab('facebook');
  const auto = urlMatchesFeature(url, 'groups')    ? 'groups'
             : urlMatchesFeature(url, 'pages')     ? 'pages'
             : urlMatchesFeature(url, 'following') ? 'following'
             : null;
  if (auto) {
    currentFeature = auto;
    revealFeaturePanel(auto);
  } else {
    showScreen('picker');
  }
}
initialRoute();

// If the tab navigates while the user is on the wrong-url screen and the new
// URL now matches their selected feature, auto-advance into the feature panel.
// (We don't auto-switch anywhere else — user is in control once they've chosen.)
chrome.tabs.onUpdated.addListener(async (_id, changeInfo) => {
  if (!(changeInfo.status === 'complete' || changeInfo.url)) return;
  if (sidePanelBusy) return;
  if (currentFeature && !screenWrongUrl.classList.contains('hidden')) {
    const url = await currentTabUrl();
    if (urlMatchesFeature(url, currentFeature)) revealFeaturePanel(currentFeature);
  }
});

// ── Messages from the content script ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'popup') return;

  if (message.type === 'STATUS') {
    setStatus(message.message);
    // Only reflect the count in the big counter during an actual run — during a
    // scan the "count" is the number of items found, which must NOT show up
    // under the "unfollowed / left" label.
    if (runActive && message.count !== undefined) setCounter(message.count);
  }

  // Pages scan returned the full list → render chips + rows
  if (message.type === 'PAGES_LIST') {
    sidePanelBusy = false;
    pagesData = message.pages || [];
    pagesSelected.clear();
    activeCats.clear();
    pagesSearch.value = '';
    btnPagesScan.disabled = false;
    setCounter(0);
    showPagesStep('review');
    renderChips();
    renderPages();
    setStatus(`Found ${pagesData.length} pages. Filter by category or keyword.`);
  }

  // Per-page result → live log
  if (message.type === 'PAGE_RESULT') {
    appendPagesLog(message.href, message.result);
  }

  // Pages unfollow finished
  if (message.type === 'PAGES_DONE') {
    sidePanelBusy = false;
    runActive = false;
    setCounter(message.count);
    setStatus(`🏁 Done — unfollowed ${pagesRunDone}, skipped ${pagesRunSkipped}.`);
    pagesSelected.clear();
    btnPagesStop.classList.add('hidden');
    btnPagesPause.classList.add('hidden');
    btnPagesResume.classList.add('hidden');
    btnPagesDone.classList.remove('hidden');
  }

  // Following scan returned the full list → render rows
  if (message.type === 'FOLLOWING_LIST') {
    sidePanelBusy = false;
    followingData = message.following || [];
    followingSelected.clear();
    followingSearch.value = '';
    btnFollowingScan.disabled = false;
    setCounter(0);
    showFollowingStep('review');
    renderFollowing();
    setStatus(`Found ${followingData.length} entries. Pick which to unfollow.`);
  }

  // Per-entry result → live log
  if (message.type === 'FOLLOWING_RESULT') {
    appendFollowingLog(message.href, message.result);
  }

  // Following unfollow finished
  if (message.type === 'FOLLOWING_DONE') {
    sidePanelBusy = false;
    runActive = false;
    setCounter(message.count);
    setStatus(`🏁 Done — unfollowed ${followingRunDone}, skipped ${followingRunSkipped}.`);
    followingSelected.clear();
    btnFollowingStop.classList.add('hidden');
    btnFollowingPause.classList.add('hidden');
    btnFollowingResume.classList.add('hidden');
    btnFollowingDone.classList.remove('hidden');
  }

  // Groups scan returned the full list
  if (message.type === 'GROUPS_LIST') {
    sidePanelBusy = false;
    groupsData = message.groups || [];
    selected.clear();
    groupsSearch.value = '';
    btnScan.disabled = false;
    setCounter(0);
    // Start the review filter at the scan scope (the list is already limited to it)
    groupsFilter.value = scanFilter.value;
    showGroupsStep('review');
    renderGroups();
    setStatus(`Found ${groupsData.length} groups. Pick which to leave.`);
  }

  // Per-group result → append to the live log
  if (message.type === 'GROUP_RESULT') {
    appendLog(message.href, message.result);
  }

  // Groups leave finished — keep the log on screen with a "Scan again" button
  if (message.type === 'GROUPS_DONE') {
    sidePanelBusy = false;
    runActive = false;
    setCounter(message.count);
    setStatus(`🏁 Done — left ${runLeft}, skipped ${runSkipped}. Review the log below.`);
    selected.clear();
    btnGroupsStop.classList.add('hidden');
    btnGroupsPause.classList.add('hidden');
    btnGroupsResume.classList.add('hidden');
    btnGroupsDone.classList.remove('hidden');
  }
});

// ── Small helper (kept for HTML-safe injection in the pages log) ────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
