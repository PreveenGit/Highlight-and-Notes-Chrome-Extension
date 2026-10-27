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

  const chrome = (globalThis.chrome = globalThis.chrome || {});
  chrome.storage = {
    local,
    onChanged: { addListener: (fn) => changedListeners.push(fn) }
  };
  chrome.runtime = {
    ...(chrome.runtime || {}),
    onMessage: { addListener: (fn) => messageListeners.push(fn) }
  };
  chrome.tabs = {
    query: async () => [{ id: 1 }],
    // The popup preview overrides this to reach a page in an iframe.
    sendMessage: (_tabId, msg) => (window.__hlTabSend ? window.__hlTabSend(msg) : deliver(msg)),
    create: async ({ url }) => console.log('[chrome-stub] tabs.create', url)
  };
  chrome.commands = {
    getAll: async () => [{ name: 'highlight-selection', shortcut: 'Alt+Shift+H' }]
  };

  // For driving the content script from tests or the console.
  window.__hlSend = deliver;
})();
