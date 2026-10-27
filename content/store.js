// Highlights for the current page, kept in chrome.storage.local under one key per page:
//   "hl:<url>" -> { url, title, highlights: [{ id, color, text, quote, position, createdAt }] }
//
// The in-memory list changes immediately so the page and the store never disagree.
// Writes re-read storage first, so a second tab open on the same URL is not overwritten.
(() => {
  const HL = globalThis.HL;
  let key = null;
  let highlights = [];
  let queue = Promise.resolve();

  // Same page => same key: drop the #hash and utm_* tracking parameters, and
  // re-serialize the query so equivalent spellings ("?a" / "?a=") match.
  function pageKey(href) {
    const url = new URL(href);
    url.hash = '';
    const params = new URLSearchParams(url.search);
    for (const name of [...params.keys()]) {
      if (name.startsWith('utm_')) params.delete(name);
    }
    url.search = params.toString();
    return HL.PAGE_KEY_PREFIX + url.href;
  }

  async function open(href) {
    key = pageKey(href);
    const page = (await chrome.storage.local.get(key))[key];
    highlights = page ? page.highlights : [];
    return highlights;
  }

  function mutate(change) {
    highlights = change(highlights);
    const k = key;
    const meta = { url: location.href, title: document.title };
    queue = queue
      .then(async () => {
        const stored = (await chrome.storage.local.get(k))[k];
        const next = change(stored ? stored.highlights : []);
        if (next.length) await chrome.storage.local.set({ [k]: { ...meta, highlights: next } });
        else await chrome.storage.local.remove(k);
      })
      .catch((err) => console.warn('[Highlight] could not save:', err));
    return queue;
  }

  HL.store = {
    pageKey,
    open,
    key: () => key,
    all: () => highlights,
    get: (id) => highlights.find((h) => h.id === id),
    add: (highlight) => mutate((list) => [...list.filter((h) => h.id !== highlight.id), highlight]),
    update: (id, patch) => mutate((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    remove: (id) => mutate((list) => list.filter((h) => h.id !== id)),
    clear: () => mutate(() => [])
  };
})();
