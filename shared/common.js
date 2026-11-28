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
    CLEAR: 'clear',
    SET_LEARN: 'set-learn' // { id, state: 'learn' | 'learned' | 'none' }
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
      // The hover text covers the note, the question and what was learned.
      noted: kept.filter((h) => HL.tooltipOf(before.get(h.id)) !== HL.tooltipOf(h)),
      flagged: kept.filter((h) => HL.learnStateOf(before.get(h.id)) !== HL.learnStateOf(h))
    };
  };

  // ---- Notes and Learn more ---------------------------------------------------
  // A highlight can have a note, and a separate Learn more track:
  //   learn: true         on the To learn list
  //   question: string    what the user wants to find out
  //   learnedAt: number   when they clicked Got it (then learn is removed): "Learned"
  //   answer: string      what they learned

  function textOf(h, field) {
    return h && typeof h[field] === 'string' ? h[field].trim() : '';
  }

  function withText(h, field, value) {
    const { [field]: _old, ...rest } = h;
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? { ...rest, [field]: text } : rest;
  }

  // A highlight's note, or '' when it has none. Notes are optional plain text.
  HL.noteOf = (h) => textOf(h, 'note');
  // Copy of `h` with its note set to `note`; an empty note removes the field.
  HL.withNote = (h, note) => withText(h, 'note', note);
  HL.questionOf = (h) => textOf(h, 'question');
  HL.withQuestion = (h, question) => withText(h, 'question', question);
  HL.answerOf = (h) => textOf(h, 'answer');
  HL.withAnswer = (h, answer) => withText(h, 'answer', answer);

  // 'learn' (to learn), 'learned' or 'none'.
  HL.learnStateOf = function learnStateOf(h) {
    if (h && h.learn) return 'learn';
    if (h && Number.isFinite(h.learnedAt)) return 'learned';
    return 'none';
  };

  // Copy of `h` moved to a Learn more state. "learned" keeps the question and
  // answer and records when; "none" drops the whole track.
  HL.withLearnState = function withLearnState(h, state, now = Date.now()) {
    const { learn: _l, learnedAt: _t, question: _q, answer: _a, ...rest } = h;
    const kept = { ...(h.question ? { question: h.question } : {}), ...(h.answer ? { answer: h.answer } : {}) };
    if (state === 'learn') return { ...rest, ...kept, learn: true };
    if (state === 'learned') return { ...rest, ...kept, learnedAt: Number.isFinite(h.learnedAt) ? h.learnedAt : now };
    return rest;
  };

  // Hover text on the page: the note, then the question and what was learned.
  HL.tooltipOf = function tooltipOf(h) {
    const state = HL.learnStateOf(h);
    const parts = [HL.noteOf(h)];
    if (state !== 'none' && HL.questionOf(h)) parts.push(`Question: ${HL.questionOf(h)}`);
    if (state === 'learned' && HL.answerOf(h)) parts.push(`Learned: ${HL.answerOf(h)}`);
    return parts.filter(Boolean).join('\n\n');
  };

  // Before 1.8 the Learn more question was saved as the note. Moves it to
  // `question` on highlights marked to learn more that have no question yet.
  // Returns the list unchanged (same object) when nothing needs to move.
  HL.moveLearnNotes = function moveLearnNotes(list) {
    let moved = false;
    const next = list.map((h) => {
      if (!h.learn || HL.questionOf(h) || !HL.noteOf(h)) return h;
      moved = true;
      return HL.withNote(HL.withQuestion(h, HL.noteOf(h)), '');
    });
    return moved ? next : list;
  };

  // Runs moveLearnNotes over every stored page, once (remembered in settings).
  HL.migrateLearnQuestions = async function migrateLearnQuestions() {
    const all = await chrome.storage.local.get(null);
    const settings = all[HL.SETTINGS_KEY] || {};
    if (settings.migrations && settings.migrations.learnQuestions) return 0;
    const updates = {};
    for (const [key, page] of Object.entries(all)) {
      if (!key.startsWith(HL.PAGE_KEY_PREFIX) || !page || !Array.isArray(page.highlights)) continue;
      const next = HL.moveLearnNotes(page.highlights);
      if (next !== page.highlights) updates[key] = { ...page, highlights: next };
    }
    updates[HL.SETTINGS_KEY] = { ...settings, migrations: { ...settings.migrations, learnQuestions: true } };
    await chrome.storage.local.set(updates);
    return Object.keys(updates).length - 1;
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
