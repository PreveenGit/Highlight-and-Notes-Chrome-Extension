// Development only: a minimal stand-in for the chrome.* APIs the extension uses,
// so the content scripts and popup can run on a plain web page (see "Development"
// in README.md). Storage lives in localStorage.
(() => {
  const PREFIX = 'chrome-stub:';
  const changedListeners = [];
  const messageListeners = [];

  const read = (key) => {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  };
  const allKeys = () =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => k.slice(PREFIX.length));
  const keysOf = (keys) => (keys == null ? allKeys() : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys));
  const fire = (changes) => setTimeout(() => changedListeners.forEach((fn) => fn(changes, 'local')));

  // Other windows/frames of this origin (e.g. the library beside the test page) get
  // the browser's "storage" event; turn it into onChanged like real Chrome would.
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const parse = (raw) => (raw === null ? undefined : JSON.parse(raw));
    fire({ [e.key.slice(PREFIX.length)]: { oldValue: parse(e.oldValue), newValue: parse(e.newValue) } });
  });

  const local = {
    async get(keys) {
      const out = {};
      for (const k of keysOf(keys)) {
        const v = read(k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: read(k), newValue: v };
        localStorage.setItem(PREFIX + k, JSON.stringify(v));
      }
      fire(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const k of keysOf(keys)) {
        changes[k] = { oldValue: read(k) };
        localStorage.removeItem(PREFIX + k);
      }
      fire(changes);
    },
    async clear() {
      return local.remove(allKeys());
    }
  };

  // Delivers a message to the content script's onMessage listeners, like
  // chrome.tabs.sendMessage from the popup or background would.
  function deliver(msg) {
    return new Promise((resolve, reject) => {
      if (!messageListeners.length) return reject(new Error('Receiving end does not exist.'));
      let pending = false;
      for (const fn of messageListeners) if (fn(msg, {}, resolve) === true) pending = true;
      if (!pending) resolve(undefined);
    });
  }

  const noEvent = { addListener() {} };
  const extensionRoot = new URL('../', document.currentScript.src);

  const chrome = (globalThis.chrome = globalThis.chrome || {});
  chrome.storage = {
    local,
    onChanged: { addListener: (fn) => changedListeners.push(fn) }
  };
  chrome.runtime = {
    ...(chrome.runtime || {}),
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
    getURL: (path) => new URL(path.replace(/^\//, ''), extensionRoot).href,
    // Synchronous like the real one; reads manifest.json once (test pages only).
    getManifest: () => {
      if (!getManifest.cache) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', new URL('manifest.json', extensionRoot).href, false);
        xhr.send();
        getManifest.cache = JSON.parse(xhr.responseText);
      }
      return getManifest.cache;
    }
  };
  function getManifest() {}
  chrome.tabs = {
    query: async () => [{ id: 1, windowId: 1 }],
    // test/preview.html sets __hlTabSend to reach the test page in its iframe.
    sendMessage: (_tabId, msg) => (window.__hlTabSend ? window.__hlTabSend(msg) : deliver(msg)),
    create: async ({ url }) => {
      console.log('[chrome-stub] tabs.create', url);
      return { id: 2, windowId: 1 };
    },
    // undefined means "not in a tab", i.e. the side panel or popup.
    getCurrent: async () => (window.__hlStubInTab ? { id: 3, windowId: 1 } : undefined),
    onActivated: noEvent,
    onUpdated: noEvent
  };
  chrome.sidePanel = {
    open: async (options) => console.log('[chrome-stub] sidePanel.open', options)
  };
  chrome.commands = {
    getAll: async () => [
      { name: 'highlight-selection', shortcut: 'Alt+Shift+H' },
      { name: 'open-side-panel', shortcut: 'Alt+Shift+L' }
    ]
  };

  // For driving the content script from tests or the console.
  window.__hlSend = deliver;
})();
