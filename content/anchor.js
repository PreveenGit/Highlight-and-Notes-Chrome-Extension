// Turns a DOM Range into something we can save, and finds it again later.
//
// "Page text" is every text node under <body> joined in document order
// (script/style/etc. excluded). Wrapping text in <mark> elements never changes
// that string, so saved offsets stay valid while other highlights exist.
//
// Each highlight stores two anchors:
//   position: { start, end }            character offsets into the page text
//   quote:    { exact, prefix, suffix } the text itself plus surrounding context
// On restore we search for `exact` and pick the occurrence whose context matches
// best, using the old position only as a tie-breaker. That survives text being
// added or removed elsewhere on the page.
(() => {
  const HL = globalThis.HL;
  const CONTEXT = 32;
  const MAX_CANDIDATES = 1000;
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'textarea']);

  function buildIndex(root = document.body) {
    const nodes = [];
    const starts = [];
    const parts = [];
    let length = 0;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.nodeType === Node.ELEMENT_NODE && SKIP_TAGS.has(node.localName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        nodes.push(node);
        starts.push(length);
        parts.push(node.data);
        length += node.data.length;
      }
    }
    return { nodes, starts, text: parts.join(''), positions: new Map(nodes.map((n, i) => [n, i])) };
  }

  // DOM boundary point (container, offset) -> offset into the page text.
  function toTextOffset(index, container, offset) {
    const i = index.positions.get(container);
    if (i !== undefined) return index.starts[i] + offset;

    // The point sits between nodes (e.g. after a triple-click): use the first
    // indexed text node at or after it.
    const probe = document.createRange();
    probe.setStart(container, offset);
    let lo = 0;
    let hi = index.nodes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (probe.comparePoint(index.nodes[mid], 0) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo < index.nodes.length ? index.starts[lo] : index.text.length;
  }

  // Range -> { position, quote }, with surrounding whitespace trimmed.
  // Returns null when the range holds no visible text.
  function fromRange(index, range) {
    const { text } = index;
    let start;
    let end;
    try {
      start = toTextOffset(index, range.startContainer, range.startOffset);
      end = toTextOffset(index, range.endContainer, range.endOffset);
    } catch {
      return null; // e.g. a selection inside a shadow root
    }
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (start >= end) return null;
    return {
      position: { start, end },
      quote: {
        exact: text.slice(start, end),
        prefix: text.slice(Math.max(0, start - CONTEXT), start),
        suffix: text.slice(end, end + CONTEXT)
      }
    };
  }

  // Saved anchor -> { start, end } in the current page text, or null if not found.
  function locate(index, { quote, position }) {
    const { text } = index;
    const { exact, prefix = '', suffix = '' } = quote || {};
    if (!exact) return null;

    let best = null;
    let at = text.indexOf(exact);
    for (let n = 0; at !== -1 && n < MAX_CANDIDATES; n++) {
      const end = at + exact.length;
      const score =
        sharedSuffix(prefix, text.slice(Math.max(0, at - prefix.length), at)) +
        sharedPrefix(suffix, text.slice(end, end + suffix.length));
      const distance = position ? Math.abs(at - position.start) : 0;
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { start: at, end, score, distance };
      }
      at = text.indexOf(exact, at + 1);
    }
    if (!best) return null;

    // A short quote like "the" with none of its old context is probably a
    // different occurrence, not the one that was highlighted.
    const needed = exact.length < 10 ? Math.min(8, prefix.length + suffix.length) : 0;
    return best.score >= needed ? { start: best.start, end: best.end } : null;
  }

  // Text offsets -> DOM Range over the indexed text nodes.
  function toRange(index, start, end) {
    const { nodes, starts } = index;
    let i = lastIndex(starts, (s) => s <= start);
    while (i >= 0 && i < nodes.length - 1 && start >= starts[i] + nodes[i].length) i++;
    const j = lastIndex(starts, (s) => s < end);
    if (i < 0 || j < 0 || end > index.text.length) return null;
    const range = document.createRange();
    range.setStart(nodes[i], start - starts[i]);
    range.setEnd(nodes[j], end - starts[j]);
    return range;
  }

  // Last index in the ascending `list` whose value satisfies `test`, or -1.
  function lastIndex(list, test) {
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (test(list[mid])) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  function sharedPrefix(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  }

  function sharedSuffix(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  }

  HL.anchor = { buildIndex, fromRange, locate, toRange };
})();
