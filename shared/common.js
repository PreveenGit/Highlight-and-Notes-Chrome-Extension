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
  HL.MAX_CUSTOM_COLORS = 5;
  // Offered when adding a custom color (the ones already in the palette are left out).
  HL.SUGGESTED_COLORS = ['#c4b5fd', '#a5b4fc', '#99f6e4', '#bef264', '#fde68a', '#fdba74', '#fda4af', '#f0abfc', '#d6d3d1'];

  HL.PAGE_KEY_PREFIX = 'hl:';
  HL.SETTINGS_KEY = 'settings';
  HL.DEFAULT_SETTINGS = {
    defaultColor: 'yellow', // also the last color picked in the toolbar
    showToolbar: true, // show the color toolbar when text is selected
    customColors: [] // the user's own colors ("#rrggbb"), shown after the built-in ones
  };

  // ---- Colors ---------------------------------------------------------------
  // A highlight's `color` is a built-in name ("yellow") or a custom "#rrggbb".

  // "#ABC", "abc", " #a1b2c3 " -> "#aabbcc" / "#a1b2c3"; anything else -> null.
  HL.parseHex = function parseHex(input) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(input || '').trim());
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return '#' + hex.toLowerCase();
  };

  HL.isColor = function isColor(color) {
    return Object.hasOwn(HL.COLORS, color) || HL.parseHex(color) === color;
  };

  // The CSS color to paint; unknown values fall back to yellow.
  HL.colorValue = function colorValue(color) {
    if (Object.hasOwn(HL.COLORS, color)) return HL.COLORS[color];
    return HL.parseHex(color) === color ? color : HL.COLORS.yellow;
  };

  // A name for people: "yellow", or the code in capitals ("#A1B2C3").
  HL.colorLabel = function colorLabel(color) {
    return Object.hasOwn(HL.COLORS, color) ? color : String(color).toUpperCase();
  };

  // Text color that reads best on `color`: near-black, or white on dark colors.
  HL.textOn = function textOn(color) {
    const hex = HL.colorValue(color).slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Contrast with #111 (luminance ~0.0056) vs. with white.
    return (luminance + 0.05) / 0.0556 >= 1.05 / (luminance + 0.05) ? '#111' : '#fff';
  };

  // The user's valid custom colors, without duplicates, at most MAX_CUSTOM_COLORS.
  HL.customColors = function customColors(settings) {
    const list = Array.isArray(settings && settings.customColors) ? settings.customColors : [];
    const out = [];
    for (const c of list) {
      const hex = HL.parseHex(c);
      if (hex && !out.includes(hex) && out.length < HL.MAX_CUSTOM_COLORS) out.push(hex);
    }
    return out;
  };

  // Every color to offer: the built-in ones, then the user's own.
  HL.palette = function palette(settings) {
    return [...HL.COLOR_NAMES, ...HL.customColors(settings)];
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
      noted: kept.filter((h) => HL.noteOf(before.get(h.id)) !== HL.noteOf(h)),
      flagged: kept.filter((h) => !!before.get(h.id).learn !== !!h.learn)
    };
  };

  // Copy of `h` marked (or no longer marked) "learn more"; unmarked removes the field.
  HL.withLearn = function withLearn(h, on) {
    const { learn: _old, ...rest } = h;
    return on ? { ...rest, learn: true } : rest;
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

  // How long ago `time` (ms since epoch) was, like "2 days ago" or "yesterday";
  // '' when there is no time. Used by the popup and the library.
  const AGO_UNITS = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];
  let relativeFormat = null; // created on first use; content scripts never need it
  HL.ago = function ago(time) {
    if (!time) return '';
    relativeFormat = relativeFormat || new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const seconds = (time - Date.now()) / 1000;
    for (const [unit, size] of AGO_UNITS) {
      if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  };

  // Stored settings with defaults filled in and bad values replaced.
  HL.cleanSettings = function cleanSettings(stored) {
    const settings = { ...HL.DEFAULT_SETTINGS, ...stored };
    settings.customColors = HL.customColors(settings);
    if (!HL.isColor(settings.defaultColor)) settings.defaultColor = HL.DEFAULT_SETTINGS.defaultColor;
    return settings;
  };

  HL.getSettings = async function getSettings() {
    const data = await chrome.storage.local.get(HL.SETTINGS_KEY);
    return HL.cleanSettings(data[HL.SETTINGS_KEY]);
  };

  HL.setSettings = async function setSettings(patch) {
    const next = { ...(await HL.getSettings()), ...patch };
    await chrome.storage.local.set({ [HL.SETTINGS_KEY]: next });
    return next;
  };
})();
