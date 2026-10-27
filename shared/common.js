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
