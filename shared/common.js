// Shared by the content scripts, the popup and the background worker.
// Everything is a classic script, so modules attach to one global `HL` object.
(() => {
  const HL = (globalThis.HL = globalThis.HL || {});

  // Highlight palette: name -> background color. Order is the order shown in the UI.
  HL.COLORS = {
    yellow: '#fff176',
    green: '#b9f6ca',
    blue: '#b3e5fc',
    pink: '#f8bbd0',
    orange: '#ffcc80'
  };
  HL.COLOR_NAMES = Object.keys(HL.COLORS);

  HL.PAGE_KEY_PREFIX = 'hl:';
  HL.SETTINGS_KEY = 'settings';
  HL.DEFAULT_SETTINGS = {
    defaultColor: 'yellow', // also the last color picked in the toolbar
    showToolbar: true // show the color toolbar when text is selected
  };

  // Message types between popup/background and the content script.
  // HIGHLIGHT_SELECTION doubles as the keyboard command name in manifest.json.
  HL.MSG = {
    HIGHLIGHT_SELECTION: 'highlight-selection',
    LIST: 'list',
    SCROLL_TO: 'scroll-to',
    DELETE: 'delete',
    CLEAR: 'clear'
  };

  // Same page => same key: drop the #hash and utm_* tracking parameters, and
  // re-serialize the query so equivalent spellings ("?a" / "?a=") match.
  HL.pageKey = function pageKey(href) {
    const url = new URL(href);
    url.hash = '';
    const params = new URLSearchParams(url.search);
    for (const name of [...params.keys()]) {
      if (name.startsWith('utm_')) params.delete(name);
    }
    url.search = params.toString();
    return HL.PAGE_KEY_PREFIX + url.href;
  };

  // Read-modify-write of one page's highlights. `change` gets the stored list and
  // returns the new one. `meta` ({ url, title }) is merged into the page record;
  // without it the stored url/title are kept. An empty list removes the page.
  HL.mutatePage = async function mutatePage(key, change, meta) {
    const stored = (await chrome.storage.local.get(key))[key];
    const next = change(stored ? stored.highlights : []);
    if (next.length) await chrome.storage.local.set({ [key]: { ...stored, ...meta, highlights: next } });
    else await chrome.storage.local.remove(key);
    return next;
  };

  // What changed between two versions of a page's highlight list.
  HL.diffHighlights = function diffHighlights(oldList, newList) {
    const before = new Map(oldList.map((h) => [h.id, h]));
    const after = new Set(newList.map((h) => h.id));
    const kept = newList.filter((h) => before.has(h.id));
    return {
      added: newList.filter((h) => !before.has(h.id)),
      removed: oldList.filter((h) => !after.has(h.id)),
      recolored: kept.filter((h) => before.get(h.id).color !== h.color),
      noted: kept.filter((h) => HL.noteOf(before.get(h.id)) !== HL.noteOf(h))
    };
  };

  // A highlight's note, or '' when it has none. Notes are optional plain text.
  HL.noteOf = function noteOf(h) {
    return h && typeof h.note === 'string' ? h.note.trim() : '';
  };

  // Copy of `h` with its note set to `note`; an empty note removes the field.
  HL.withNote = function withNote(h, note) {
    const { note: _old, ...rest } = h;
    const text = typeof note === 'string' ? note.trim() : '';
    return text ? { ...rest, note: text } : rest;
  };

  HL.getSettings = async function getSettings() {
    const data = await chrome.storage.local.get(HL.SETTINGS_KEY);
    return { ...HL.DEFAULT_SETTINGS, ...data[HL.SETTINGS_KEY] };
  };

  HL.setSettings = async function setSettings(patch) {
    const next = { ...(await HL.getSettings()), ...patch };
    await chrome.storage.local.set({ [HL.SETTINGS_KEY]: next });
    return next;
  };
})();
