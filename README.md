# ⚡ Social Cleaner

## 🌪️ The Feed That Wouldn't End

Ah yes. 2010.

A simpler time. You were young, optimistic, and absolutely thrilled to like that pizza brand's Facebook page in exchange for a 10% coupon you never used. You followed a motivational quotes page. Then another. You joined a group about a hobby you tried once. You followed a celebrity fan page for someone who is now, somehow, a podcaster.

Fast forward to today. Your Facebook feed is an archaeological dig of your past questionable decisions — sponsored posts sandwiched between pages that haven't posted since the Obama administration, a "Daily Inspiration" account that reposts the same sunset JPEG every 72 hours, and 500 dead groups you don't remember joining.

You decided to clean it up manually. Brave. Noble, even. Click. ⋯. Leave group. Confirm. Scroll. Forty down. Four hundred and sixty to go.

But then — **Social Cleaner**.

A humble little Chrome extension that does the digital equivalent of hiring someone to clean out your attic while you sit downstairs pretending it isn't happening. It scrolls. It unfollows. It leaves. It takes polite little breaks so Facebook doesn't get suspicious. It doesn't judge you for following "Minion Memes Official" in 2015. It just quietly, efficiently fixes it.

**Social Cleaner ⚡ — because someone had to.**

*Instagram, X/Twitter, and LinkedIn support are on the roadmap.*

---

![Version](https://img.shields.io/badge/version-2.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Chrome-yellow)

---

## ✨ What it does

Three Facebook clean-up tools, each with the same simple flow — **scan → filter → pick → confirm → go**:

- 📄 **Pages** — unfollow the pages you follow. Filter by **category** (auto-detected chips like _Blogger_, _Shopping_, _Public figure_) or by keyword.
- 👥 **Groups** — leave joined groups. Filter by **how long since you last visited** (e.g. "1+ year") to surface the dead ones, plus keyword.
- 👤 **Following** — unfollow profiles **and** pages from your Following list. Filter by keyword.

Plus:

- 🧭 **Side panel UI** — opens on the right and stays open while you work; auto-detects which Facebook page you're on.
- ⏸️ **Pause / Resume / Stop** on every run — pause holds your place; resume picks up the same queue.
- 🐢 **Human-paced** with randomized delays and periodic rests, to stay under Facebook's automation radar.
- 📋 **Live log** — every item marked done ✅ or skipped ⏭️ (with the reason).
- 🚧 Instagram / X / LinkedIn tabs are present as "coming soon".

---

## ⚠️ Disclaimer

This extension automates actions on Facebook. **Use it responsibly.** Excessive automation may violate Facebook's Terms of Service and could result in temporary restrictions on your account. Leaving a **private** group can be irreversible (rejoining may need admin approval). Social Cleaner always asks you to confirm before acting and only ever touches the items you select.

**Use at your own risk.**

---

## 🚀 Installation (Chrome)

> Not on the Chrome Web Store yet. Install manually:

1. Download or clone this repository:
   ```bash
   git clone https://github.com/NoCodegeek/social-cleaner.git
   ```
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. Click the ⚡ **Social Cleaner** icon in your toolbar — the panel opens on the right

> After any update, reload the extension **and** refresh your Facebook tab so the fresh content script is injected.

---

## 📖 Usage

Open the side panel, choose the **Facebook** tab, then pick a tool. If you're not on the right page, the panel shows a **"Take me there"** button that navigates for you.

### 📄 Unfollow Pages
1. Go to `facebook.com/pages/?category=liked` (or use "Take me there")
2. **Scan my pages** — it scrolls the whole list
3. Filter by **category chip** and/or keyword, then tick pages (or **All**)
4. **Unfollow selected** → confirm → watch the log

### 👥 Leave Groups
1. Go to `facebook.com/groups/joins`
2. Optionally set **"Not visited in…"**, then **Scan my groups**
3. Refine by keyword, tick groups (or **All**)
4. **Leave selected** → confirm

### 👤 Unfollow Following (profiles & pages)
1. Go to `facebook.com/me/following`
2. **Scan my following** → filter by keyword → tick entries
3. **Unfollow selected** → confirm

> Unfollowing a **profile** hides their posts but keeps the friendship. Unfollowing a **page** is fully reversible.

---

## 🛠️ During a run

| Button | Action |
|---|---|
| **⏸ Pause** | Halt before the next item, holding your place |
| **▶ Resume** | Continue the same queue from where you paused |
| **⛔ Stop** | End the run (abandons the remaining queue) |

The counter shows how many items have been actioned; the log lists each one with its result.

---

## 🗂️ Project structure

```
social-cleaner/
├── manifest.json      # MV3 config: side panel, content script, permissions
├── ARCHITECTURE.md    # How it works: components, message flow, diagrams
├── background.js      # Service worker: opens the panel, routes messages
├── popup/
│   ├── popup.html     # Side-panel UI
│   ├── popup.css      # Styles
│   └── popup.js       # Screens, filters, run control
├── content/
│   └── content.js     # All page automation (Pages / Groups / Following)
└── icons/
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the full design and message-flow diagrams.

---

## 🤝 Contributing

Contributions welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to add a new platform or surface.

---

## 📄 License

MIT © [NoCodeGeek](https://github.com/NoCodegeek)
