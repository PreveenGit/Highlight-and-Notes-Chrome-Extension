// Adds and removes the <mark> elements that make highlights visible.
// One highlight can span many text nodes (bold, links, several paragraphs), so it
// becomes several <mark class="hl-mark"> elements sharing the same data-hl-id.
(() => {
  const HL = globalThis.HL;
  const MARK_CLASS = 'hl-mark';
  const FLASH_CLASS = 'hl-flash';
  const NOTE_CLASS = 'hl-note-badge';
  const SKIP_SELECTOR = 'script, style, noscript, template, textarea, input, select, option';

  function selector(id) {
    return `mark.${MARK_CLASS}[data-hl-id="${CSS.escape(id)}"]`;
  }

  // Wraps the text inside `range` and returns the created marks.
  function wrapRange(range, id, color) {
    // Work out every piece first: splitting nodes below moves the range's boundaries.
    const pieces = [];
    for (const node of textNodesIn(range)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (start >= end) continue;
      if (!node.data.slice(start, end).trim() && !isInlineWhitespace(node)) continue;
      pieces.push({ node, start, end });
    }

    const marks = [];
    for (const { node, start, end } of pieces) {
      let target = node;
      if (end < target.length) target.splitText(end);
      if (start > 0) target = target.splitText(start);
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      mark.dataset.hlId = id;
      paint(mark, color);
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    return marks;
  }

  function textNodesIn(range) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) return isWrappable(root) ? [root] : [];
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) {
        if (out.length) break; // past the end of the range
        continue;
      }
      if (isWrappable(node)) out.push(node);
    }
    return out;
  }

  function isWrappable(node) {
    const parent = node.parentElement;
    return !!parent && !parent.closest(SKIP_SELECTOR) && !parent.isContentEditable;
  }

  // Whitespace between inline elements ("<b>a</b> <i>b</i>") should be highlighted
  // so there is no gap. Whitespace between blocks, list items or table cells should
  // not: a <mark> there would be invalid markup or show up as a stray colored space.
  function isInlineWhitespace(node) {
    const isInline = (n) => {
      if (!n) return false;
      if (n.nodeType === Node.TEXT_NODE) return n.data.trim() !== '';
      return n.nodeType === Node.ELEMENT_NODE && getComputedStyle(n).display.startsWith('inline');
    };
    return isInline(node.previousSibling) && isInline(node.nextSibling);
  }

  function paint(mark, color) {
    mark.dataset.hlColor = color;
    mark.style.setProperty('background-color', HL.COLORS[color] || HL.COLORS.yellow, 'important');
  }

  function getMarks(id) {
    return Array.from(document.querySelectorAll(selector(id)));
  }

  function exists(id) {
    return document.querySelector(selector(id)) !== null;
  }

  function first(id) {
    return document.querySelector(selector(id));
  }

  function unwrap(id) {
    const parents = new Set();
    for (const mark of getMarks(id)) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parents.add(parent);
    }
    parents.forEach((parent) => parent.normalize());
  }

  function unwrapAll() {
    const ids = new Set(Array.from(document.querySelectorAll(`mark.${MARK_CLASS}`), (m) => m.dataset.hlId));
    ids.forEach(unwrap);
  }

  function recolor(id, color) {
    getMarks(id).forEach((mark) => paint(mark, color));
  }

  // Shows a note as a hover tooltip on every mark and a badge after the last one.
  // The badge is a CSS ::after, so the page text (and the anchor index) is unchanged.
  function setNote(id, note) {
    const text = typeof note === 'string' ? note.trim() : '';
    const marks = getMarks(id);
    marks.forEach((mark, i) => {
      if (text) mark.title = text;
      else mark.removeAttribute('title');
      mark.classList.toggle(NOTE_CLASS, !!text && i === marks.length - 1);
    });
  }

  // Scrolls the highlight into view and pulses it. Returns false if it isn't on the page.
  function flash(id) {
    const marks = getMarks(id);
    if (!marks.length) return false;
    marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    for (const mark of marks) {
      mark.classList.remove(FLASH_CLASS);
      void mark.offsetWidth; // restart the animation
      mark.classList.add(FLASH_CLASS);
    }
    setTimeout(() => marks.forEach((mark) => mark.classList.remove(FLASH_CLASS)), 2000);
    return true;
  }

  HL.marker = { MARK_CLASS, wrapRange, unwrap, unwrapAll, recolor, setNote, flash, getMarks, exists, first };
})();
