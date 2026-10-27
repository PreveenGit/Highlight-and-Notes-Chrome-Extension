# Highlight — a Chrome extension

Highlight words and sentences on any web page, like a highlighter pen. Highlights are saved per page and come back when you revisit it. A library lists the highlights from every page, in Chrome's side panel or a full tab.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (`highlight`).
4. Reload any tabs that were already open — the extension only starts in pages loaded after it is installed.

After pulling changes, click the reload icon on the extension's card in `chrome://extensions`, then reload your tabs.

To use it on local `file://` pages, open the extension's **Details** and turn on **Allow access to file URLs**.

## Use

- **Highlight:** select text and click a color in the toolbar that pops up. Or press **Alt+Shift+H** to use your last color.
- **Change or remove:** click a highlight to recolor it, copy its text, or delete it.
- **Popup** (toolbar icon): lists the page's highlights. Click one to jump to it, ✕ to delete it, plus **Copy as Markdown** and **Clear page**. It also holds the default color, the "show toolbar" setting and a link to change the shortcuts (`chrome://extensions/shortcuts`).
- **Library** — every highlight on every page. Open it in the **side panel** with the popup's side-panel button or **Alt+Shift+L**, or in a **full tab** with the popup's other button (or **Open in a tab** inside the side panel).
  - **This page** (side panel only) follows the tab you're on. **All pages** shows one card per page. **Timeline** lists every highlight, newest first.
  - Search matches highlight text, page titles and URLs (every word must match). Color chips filter by color, and the menu sorts by newest, oldest, site or most highlights.
  - Click a highlight to jump to it: on the current tab it scrolls there, otherwise the page opens in a new tab and scrolls once the highlight is restored.
  - Recolor, copy or delete single highlights, or copy/delete a whole page's. Deleting shows **Undo** for a few seconds. Open tabs update right away.
  - The **⋮** menu exports what you see as Markdown, exports everything as a JSON backup, and imports a backup. Importing merges: highlights you already have are kept and skipped.

Highlights can't be added on Chrome's own pages (`chrome://…`), the Chrome Web Store or the built-in PDF viewer, or inside text boxes and editable areas.

## How it works

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3: content scripts on all pages, side panel, keyboard commands; permissions `storage`, `unlimitedStorage`, `sidePanel`, `favicon` |
| `shared/common.js` | Color palette, storage keys, message types, settings, page keys, shared storage writes (used everywhere) |
| `shared/theme.css` | Color tokens for the popup and library (light and dark) |
| `content/anchor.js` | Converts a selection into a saveable anchor and finds it again |
| `content/marker.js` | Wraps / unwraps the `<mark class="hl-mark">` elements |
| `content/store.js` | Per-page storage, and syncing with changes made elsewhere |
| `content/toolbar.js` | Floating toolbar (closed Shadow DOM, so page CSS can't touch it) |
| `content/main.js` | Wiring: selection events, restore on load, messages |
| `content/highlight.css` | Highlight styles |
| `background.js` | Keyboard commands: highlight the selection, open the side panel |
| `popup/` | The toolbar popup |
| `library/` | The library page (side panel and tab); `data.js` holds its search, sort, export and import logic |

**Saving.** Each page is stored under the key `hl:<url>` (the `#hash` and `utm_*` parameters are dropped, so they count as the same page). Every highlight keeps two anchors: its character offsets in the page text, and a quote — the exact text plus 32 characters of context on each side.

**Restoring.** On load the extension searches the page text for each quote and picks the occurrence whose surrounding context matches best, using the old offset only to break ties. This still works when text is added or removed elsewhere on the page. A short quote (under 10 characters) whose context is gone is not restored, since it would likely land on the wrong word. Highlights that can't be found are kept and shown greyed out in the popup.

**Dynamic pages.** A `MutationObserver` retries unfound highlights while content loads (quickly for 10 seconds, then at most every 3 seconds), puts highlights back if the page re-renders and drops them, and notices single-page-app URL changes.

**Live sync.** The library edits storage directly. Each open tab listens for changes to its own page key, re-reads storage once its own pending writes have landed, and adds, removes or recolors marks to match. The same mechanism keeps two tabs of the same page in step.

## Development

There is no build step: edit a file, then click the reload icon on the extension's card in `chrome://extensions` and reload the page.

The `test/` folder runs the extension code on plain pages. Serve the project folder first:

```bash
python -m http.server 8000
```

- `http://localhost:8000/test/harness.html` — automated checks of anchoring, marking and the library's data functions. The page title shows `PASS n/n` or `FAIL k/n`.
- `http://localhost:8000/test/test-page.html` — a manual test page (formatting, lists, tables, inputs, late-loading text, SPA navigation). Use it with the installed extension.
- `http://localhost:8000/test/test-page.html?stub` — the same page running the content scripts directly with a fake `chrome.*` API (`test/chrome-stub.js`, storage in `localStorage`), so it works without installing the extension. Don't use `?stub` while the extension is installed, or both copies will run.
- `http://localhost:8000/test/preview.html?ui=popup|panel|tab` — the popup or the library next to the stubbed test page. Add `&seed` to fill storage with a few sample pages.

## Not yet

Notes on highlights, highlights inside iframes or shadow DOM, syncing across devices, and automatic keyword highlighting.
