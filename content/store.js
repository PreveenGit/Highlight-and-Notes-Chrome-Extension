// Highlights for the current page, kept in chrome.storage.local under one key per page:
//   "hl:<url>" -> { url, title, highlights: [{ id, color, text, quote, position, createdAt, note?, bookmark? }] }
// A bookmark is a highlight with bookmark: true, at most one per page.
//
// The in-memory list changes immediately so the page and the store never disagree.
// Writes re-read storage first (HL.mutatePage), so another tab on the same URL is
// not overwritten. Changes made elsewhere (the library, another tab) are picked up
// through storage.onChanged and reported to onExternalChange.
(() => {
  const HL = globalThis.HL;
  let key = null;
  let highlights = [];
  let queue = Promise.resolve();
  let pendingWrites = 0;
  let onExternal = () => {};

  async function open(href) {
    key = HL.pageKey(href);
    const page = (await chrome.storage.local.get(key))[key];
    highlights = page ? page.highlights : [];
    return highlights;
  }

  function mutate(change) {
    highlights = change(highlights);
    const k = key;
    const meta = { url: location.href, title: document.title };
    pendingWrites++;
    queue = queue
      .then(() => HL.mutatePage(k, change, meta))
      .catch((err) => console.warn('[Highlight] could not save:', err))
      .finally(() => pendingWrites--);
    return queue;
  }

  // Brings memory in line with storage after an outside change. Queued behind our
  // own writes; skipped while later writes of ours are still pending, because their
  // own change events will reconcile once they land (an in-between state would
  // look like our newest highlights had been deleted).
  function reconcile() {
    const k = key;
    queue = queue
      .then(async () => {
        if (pendingWrites || k !== key) return;
        const stored = (await chrome.storage.local.get(k))[k];
        if (pendingWrites || k !== key) return; // we changed something while reading
        const next = stored ? stored.highlights : [];
        const diff = HL.diffHighlights(highlights, next);
        highlights = next;
        if (diff.added.length || diff.removed.length || diff.recolored.length || diff.noted.length) onExternal(diff);
      })
      .catch((err) => console.warn('[Highlight] could not sync:', err));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && key && changes[key]) reconcile();
  });

  HL.store = {
    open,
    key: () => key,
    all: () => highlights,
    get: (id) => highlights.find((h) => h.id === id),
    add: (highlight) => mutate((list) => [...list.filter((h) => h.id !== highlight.id), highlight]),
    update: (id, patch) => mutate((list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h))),
    setNote: (id, note) => mutate((list) => list.map((h) => (h.id === id ? HL.withNote(h, note) : h))),
    remove: (id) => mutate((list) => list.filter((h) => h.id !== id)),
    clear: () => mutate(() => []),
    onExternalChange: (fn) => {
      onExternal = fn;
    }
  };
})();
