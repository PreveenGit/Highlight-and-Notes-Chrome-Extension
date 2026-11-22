// Pure data functions for the library: no DOM and no chrome.* calls, so the
// test harness can exercise them directly. Depends on shared/common.js.
(() => {
  const HL = globalThis.HL;
  const BACKUP_FORMAT = 'highlight-backup';
  const BACKUP_VERSION = 1;

  // chrome.storage.local.get(null) output -> list of pages:
  // { key, url, title, site, highlights, firstAt, lastAt }
  function toPages(items) {
    const pages = [];
    for (const [key, value] of Object.entries(items || {})) {
      if (!key.startsWith(HL.PAGE_KEY_PREFIX)) continue;
      if (!value || !Array.isArray(value.highlights) || !value.highlights.length) continue;
      const url = value.url || key.slice(HL.PAGE_KEY_PREFIX.length);
      const times = value.highlights.map((h) => h.createdAt || 0);
      pages.push({
        key,
        url,
        title: value.title || url,
        site: siteOf(url),
        highlights: value.highlights,
        firstAt: Math.min(...times),
        lastAt: Math.max(...times)
      });
    }
    return pages;
  }

  function siteOf(url) {
    try {
      const { hostname, protocol } = new URL(url);
      return hostname.replace(/^www\./, '') || (protocol === 'file:' ? 'Local file' : url);
    } catch {
      return url;
    }
  }

  const PAGE_SORTS = {
    newest: (a, b) => b.lastAt - a.lastAt,
    oldest: (a, b) => a.firstAt - b.firstAt,
    site: (a, b) => a.site.localeCompare(b.site) || a.title.localeCompare(b.title),
    most: (a, b) => b.highlights.length - a.highlights.length || b.lastAt - a.lastAt
  };

  // Applies search and color filters, then sorts.
  //   query:  every word must appear in the highlight text, its note, page title or URL
  //   colors: color names to keep (empty = all)
  //   sort:   newest | oldest | site | most
  // Returns { pages, timeline, count }. Pages keep only their matching highlights,
  // in page order; the timeline is every match, newest first (or oldest first).
  function filterAndSort(pages, { query = '', colors = [], sort = 'newest' } = {}) {
    const terms = searchTerms(query);
    const colorSet = new Set(colors);
    const out = [];
    for (const page of pages) {
      const pageText = `${page.title}\n${page.url}`.toLowerCase();
      const highlights = page.highlights.filter((h) => {
        // A bookmark has no highlight color, so color filters leave it out.
        if (colorSet.size && (h.bookmark || !colorSet.has(h.color))) return false;
        const own = `${h.text || ''}\n${HL.noteOf(h)}`.toLowerCase();
        return terms.every((t) => pageText.includes(t) || own.includes(t));
      });
      if (highlights.length) out.push({ ...page, highlights: inPageOrder(highlights) });
    }
    out.sort(PAGE_SORTS[sort] || PAGE_SORTS.newest);
    const timeline = out
      .flatMap((page) => page.highlights.map((highlight) => ({ highlight, page })))
      .sort((a, b) =>
        sort === 'oldest'
          ? a.highlight.createdAt - b.highlight.createdAt
          : b.highlight.createdAt - a.highlight.createdAt
      );
    return { pages: out, timeline, count: timeline.length };
  }

  function searchTerms(query) {
    return String(query).toLowerCase().split(/\s+/).filter(Boolean);
  }

  function inPageOrder(highlights) {
    const start = (h) => (h.position ? h.position.start : Infinity);
    return [...highlights].sort((a, b) => start(a) - start(b));
  }

  // Pages -> Markdown, one section per page with each highlight as a quote and
  // its note, if any, as a paragraph after it.
  function toMarkdown(pages) {
    const lines = [];
    for (const page of pages) {
      lines.push(`## [${page.title.replace(/[[\]]/g, '\\$&')}](${page.url.replace(/[ ()]/g, encodeURIComponent)})`, '');
      for (const h of page.highlights) {
        lines.push(`> ${h.bookmark ? '🔖 ' : ''}${String(h.text).replace(/\s+/g, ' ').trim()}`, '');
        const note = HL.noteOf(h);
        // Two trailing spaces keep the note's own line breaks in rendered Markdown.
        if (note) lines.push(`**Note:** ${note.split(/\r?\n/).map((l) => l.trimEnd()).join('  \n')}`, '');
      }
    }
    return lines.join('\n').trim() + '\n';
  }

  function toBackup(pages, now = Date.now()) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date(now).toISOString(),
      pages: pages.map(({ url, title, highlights }) => ({ url, title, highlights }))
    };
  }

  // Backup file text -> [{ key, url, title, highlights }]. Throws an Error with a
  // message fit for the user when the file can't be used. Bad entries are dropped.
  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("This file isn't valid JSON.");
    }
    if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.pages)) {
      throw new Error("This isn't a Highlight backup file.");
    }
    if (data.version > BACKUP_VERSION) {
      throw new Error('This backup was made by a newer version of the extension.');
    }
    const pages = [];
    for (const page of data.pages) {
      if (!page || typeof page.url !== 'string' || !Array.isArray(page.highlights)) continue;
      let key;
      try {
        key = HL.pageKey(page.url);
      } catch {
        continue; // not a URL
      }
      const highlights = page.highlights.filter(isValidHighlight).map(cleanHighlight);
      if (!highlights.length) continue;
      pages.push({ key, url: page.url, title: typeof page.title === 'string' ? page.title : page.url, highlights });
    }
    return pages;
  }

  function isValidHighlight(h) {
    return !!h && typeof h.id === 'string' && !!h.quote && typeof h.quote.exact === 'string' && h.quote.exact !== '';
  }

  function cleanHighlight(h) {
    const str = (v) => (typeof v === 'string' ? v : '');
    const position =
      h.position && Number.isFinite(h.position.start) && Number.isFinite(h.position.end)
        ? { start: h.position.start, end: h.position.end }
        : undefined;
    return HL.withNote(
      {
        id: h.id,
        color: HL.COLORS[h.color] ? h.color : 'yellow',
        text: str(h.text) || h.quote.exact,
        quote: { exact: h.quote.exact, prefix: str(h.quote.prefix), suffix: str(h.quote.suffix) },
        position,
        createdAt: Number.isFinite(h.createdAt) ? h.createdAt : Date.now(),
        ...(h.bookmark === true ? { bookmark: true } : {})
      },
      h.note
    );
  }

  // Adds `incoming` highlights to `list`, skipping ids already there (existing ones win).
  function mergeHighlights(list, incoming) {
    const ids = new Set(list.map((h) => h.id));
    const added = [];
    for (const h of incoming) {
      if (ids.has(h.id)) continue;
      ids.add(h.id);
      added.push(h);
    }
    return { list: [...list, ...added], added: added.length, skipped: incoming.length - added.length };
  }

  HL.data = { toPages, siteOf, filterAndSort, searchTerms, toMarkdown, toBackup, parseBackup, mergeHighlights };
})();
