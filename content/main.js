// Wires everything together on the page: selection -> toolbar -> highlight,
// restoring saved highlights, and messages from the popup and keyboard shortcut.
(() => {
  const HL = globalThis.HL;
  if (HL.started) return;
  HL.started = true;

  const FAST_RETRY_MS = 10000; // retry restoring aggressively for this long after load
  const SLOW_RETRY_MS = 3000; // after that, at most this often

  let settings = { ...HL.DEFAULT_SETTINGS };
  let currentHref = location.href;
  let unresolved = new Set(); // saved highlights not yet found on the page
  let fastUntil = 0;
  let lastAttempt = 0;
  let checkTimer = null;
  let pendingRange = null; // selection the "create" toolbar acts on
  let activeId = null; // highlight the "edit" toolbar acts on

  init();

  async function init() {
    HL.toolbar.init(onToolbarAction);
    HL.store.onExternalChange(applyExternalChange);
    bindEvents();
    settings = await HL.getSettings();
    await loadPage();
  }

  // ---- Restoring ---------------------------------------------------------

  async function loadPage() {
    const highlights = await HL.store.open(location.href);
    unresolved = new Set(highlights.map((h) => h.id));
    fastUntil = Date.now() + FAST_RETRY_MS;
    restorePending();
  }

  function restorePending() {
    lastAttempt = Date.now();
    if (!unresolved.size || !document.body) return;
    const index = HL.anchor.buildIndex();
    const found = [];
    for (const h of HL.store.all()) {
      if (!unresolved.has(h.id)) continue;
      const at = HL.anchor.locate(index, h);
      if (at) found.push({ h, at });
    }
    // Oldest first so overlapping highlights nest the way they were made.
    // The page text doesn't change while wrapping, but its text nodes do, so
    // re-index before each one.
    for (const { h, at } of found) {
      const range = HL.anchor.toRange(HL.anchor.buildIndex(), at.start, at.end);
      if (range && HL.marker.wrapRange(range, h.id, h.color).length) {
        unresolved.delete(h.id);
        HL.marker.setNote(h.id, h.note);
      }
    }
  }

  // Runs (throttled) after DOM changes: handles SPA navigation, late-loading
  // content, and frameworks that re-render and drop our marks.
  function scheduleCheck() {
    if (checkTimer) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      check();
    }, 400);
  }

  function check() {
    if (location.href !== currentHref) {
      onUrlChange();
      return;
    }
    for (const h of HL.store.all()) {
      if (!unresolved.has(h.id) && !HL.marker.exists(h.id)) {
        unresolved.add(h.id);
        fastUntil = Date.now() + FAST_RETRY_MS;
      }
    }
    if (unresolved.size && (Date.now() < fastUntil || Date.now() - lastAttempt > SLOW_RETRY_MS)) {
      restorePending();
    }
  }

  async function onUrlChange() {
    currentHref = location.href;
    if (HL.pageKey(location.href) === HL.store.key()) return; // only the #hash changed
    HL.toolbar.hide();
    HL.marker.unwrapAll();
    await loadPage();
  }

  // ---- Creating and editing ----------------------------------------------

  function newId() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Returns the new highlight's id, or null if nothing could be highlighted.
  function highlightRange(range, color) {
    if (!range || range.collapsed) return null;
    const index = HL.anchor.buildIndex();
    const anchor = HL.anchor.fromRange(index, range);
    if (!anchor) return null;
    // Wrap the trimmed text we are about to save, not the raw selection.
    const target = HL.anchor.toRange(index, anchor.position.start, anchor.position.end);
    // Display text for the popup and copying. The selection's text keeps the breaks the
    // browser renders between blocks and table cells, which the raw page text lacks.
    const sel = window.getSelection();
    const text = (sel.isCollapsed ? anchor.quote.exact : sel.toString()).replace(/\s+/g, ' ').trim();
    const id = newId();
    if (!target || !HL.marker.wrapRange(target, id, color).length) return null;
    sel.removeAllRanges();
    HL.store.add({ id, color, text: text || anchor.quote.exact, ...anchor, createdAt: Date.now() });
    return id;
  }

  function highlightSelection(color) {
    const range = selectedRange();
    return range ? highlightRange(range, color) : null;
  }

  function removeHighlight(id) {
    HL.store.remove(id);
    unresolved.delete(id);
    HL.marker.unwrap(id);
  }

  function clearPage() {
    HL.store.clear();
    unresolved.clear();
    HL.marker.unwrapAll();
  }

  function recolor(id, color) {
    HL.store.update(id, { color });
    HL.marker.recolor(id, color);
  }

  function saveNote(id, note) {
    const saved = HL.store.get(id);
    if (!saved || HL.noteOf(saved) === String(note || '').trim()) return;
    HL.store.setNote(id, note);
    HL.marker.setNote(id, note);
  }

  // Opens the note editor on the clicked highlight, or first highlights the
  // selection (in the default color) when the toolbar was shown for one.
  function openNoteEditor() {
    if (!activeId) {
      activeId = highlightRange(pendingRange, settings.defaultColor);
      pendingRange = null;
    }
    const marks = activeId ? HL.marker.getMarks(activeId) : [];
    if (!marks.length) {
      activeId = null;
      HL.toolbar.hide();
      return;
    }
    const rect = Array.from(marks[0].getClientRects()).find((r) => r.width && r.height) || marks[0].getBoundingClientRect();
    HL.toolbar.showNote(rect, { text: HL.noteOf(HL.store.get(activeId)) });
  }

  // Highlights changed outside this tab (the library, the popup in another tab,
  // an import, or the same page open twice).
  function applyExternalChange({ added, removed, recolored, noted }) {
    for (const h of removed) {
      unresolved.delete(h.id);
      HL.marker.unwrap(h.id);
      if (h.id === activeId) HL.toolbar.hide();
    }
    for (const h of recolored) HL.marker.recolor(h.id, h.color);
    for (const h of noted) HL.marker.setNote(h.id, h.note);
    if (added.length) {
      added.forEach((h) => unresolved.add(h.id));
      fastUntil = Date.now() + FAST_RETRY_MS;
      restorePending();
    }
  }

  function rememberColor(color) {
    if (settings.defaultColor !== color) {
      settings.defaultColor = color;
      HL.setSettings({ defaultColor: color });
    }
  }

  // `value` is the color for "color" and the typed text for "note-save".
  function onToolbarAction(action, value) {
    if (action === 'note') {
      openNoteEditor(); // keeps activeId for the editor's Save
      return;
    }
    if (action === 'color') {
      if (activeId) recolor(activeId, value);
      else highlightRange(pendingRange, value);
      rememberColor(value);
    } else if (action === 'note-save' && activeId) {
      saveNote(activeId, value);
    } else if (action === 'copy' && activeId) {
      const saved = HL.store.get(activeId);
      copyText(saved ? saved.text : HL.marker.getMarks(activeId).map((m) => m.textContent).join(''));
    } else if (action === 'delete' && activeId) {
      removeHighlight(activeId);
    }
    pendingRange = null;
    activeId = null;
    HL.toolbar.hide();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back for plain http pages.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position: fixed; opacity: 0;';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  // ---- Selection and toolbar ---------------------------------------------

  // The current selection, if it is something we can highlight.
  function selectedRange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const active = document.activeElement;
    if (active && (active.matches('input, textarea, select') || active.isContentEditable)) return null;
    const range = sel.getRangeAt(0);
    if (!range.toString().trim()) return null;
    return range;
  }

  function showCreateToolbar(fallbackPoint) {
    const range = selectedRange();
    if (!range || !settings.showToolbar) return false;
    pendingRange = range.cloneRange();
    activeId = null;
    // Sit above the first selected line; the bounding box of a multi-line
    // selection can span whole blocks and put the toolbar far from the text.
    let rect = Array.from(range.getClientRects()).find((r) => r.width && r.height);
    if (!rect && fallbackPoint) rect = pointRect(fallbackPoint);
    if (!rect) return false;
    HL.toolbar.show(rect, { mode: 'create', color: settings.defaultColor });
    return true;
  }

  function showEditToolbar(mark) {
    activeId = mark.dataset.hlId;
    pendingRange = null;
    const hasNote = !!HL.noteOf(HL.store.get(activeId));
    HL.toolbar.show(mark.getBoundingClientRect(), { mode: 'edit', color: mark.dataset.hlColor, hasNote });
  }

  function pointRect({ x, y }) {
    return { top: y, bottom: y, left: x, right: x, width: 0, height: 0 };
  }

  function onMouseUp(e) {
    if (e.button !== 0 || HL.toolbar.owns(e)) return;
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      if (showCreateToolbar({ x: e.clientX, y: e.clientY })) return;
      const mark = e.target instanceof Element ? e.target.closest(`mark.${HL.marker.MARK_CLASS}`) : null;
      if (mark && window.getSelection().isCollapsed) showEditToolbar(mark);
      else HL.toolbar.hide();
    });
  }

  function onKeyUp(e) {
    if (HL.toolbar.owns(e)) return; // typing in the note editor
    if (e.key === 'Shift' || e.shiftKey) {
      if (!showCreateToolbar()) HL.toolbar.hide();
    }
  }

  function bindEvents() {
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener(
      'mousedown',
      (e) => {
        if (HL.toolbar.owns(e)) return;
        // Clicking away from the note editor keeps what was typed.
        if (HL.toolbar.isEditingNote()) HL.toolbar.commitNote();
        else HL.toolbar.hide();
      },
      true
    );
    document.addEventListener(
      'keydown',
      (e) => {
        // The note editor handles its own Escape (cancel).
        if (e.key === 'Escape' && !HL.toolbar.owns(e)) HL.toolbar.hide();
      },
      true
    );
    // The note editor stays open on scroll and resize so typing isn't lost.
    const hideUnlessEditing = () => {
      if (!HL.toolbar.isEditingNote()) HL.toolbar.hide();
    };
    window.addEventListener('scroll', hideUnlessEditing, { capture: true, passive: true });
    window.addEventListener('resize', hideUnlessEditing);
    window.addEventListener('popstate', scheduleCheck);

    if (document.body) {
      new MutationObserver(scheduleCheck).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      const change = changes[HL.SETTINGS_KEY];
      if (area !== 'local' || !change) return;
      settings = { ...HL.DEFAULT_SETTINGS, ...change.newValue };
      if (!settings.showToolbar && pendingRange) HL.toolbar.hide();
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      Promise.resolve()
        .then(() => handleMessage(msg))
        .then(sendResponse, (err) => sendResponse({ error: String(err) }));
      return true; // respond asynchronously
    });
  }

  // ---- Messages from the popup / keyboard shortcut -----------------------

  function handleMessage(msg) {
    switch (msg && msg.type) {
      case HL.MSG.HIGHLIGHT_SELECTION:
        HL.toolbar.commitNote();
        HL.toolbar.hide();
        return { ok: !!highlightSelection(settings.defaultColor) };
      case HL.MSG.LIST:
        return { title: document.title, url: location.href, highlights: listHighlights() };
      case HL.MSG.SCROLL_TO:
        return { ok: HL.marker.flash(msg.id) };
      case HL.MSG.DELETE:
        removeHighlight(msg.id);
        return { ok: true };
      case HL.MSG.CLEAR:
        clearPage();
        return { ok: true };
      default:
        return undefined;
    }
  }

  // Highlights in page order; ones not found on the page go last.
  function listHighlights() {
    const items = HL.store.all().map((h) => ({ h, mark: HL.marker.first(h.id) }));
    items.sort((a, b) => {
      if (a.mark && b.mark) return a.mark.compareDocumentPosition(b.mark) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      if (a.mark || b.mark) return a.mark ? -1 : 1;
      return a.h.createdAt - b.h.createdAt;
    });
    return items.map(({ h, mark }) => ({
      id: h.id,
      color: h.color,
      text: h.text,
      note: HL.noteOf(h) || undefined,
      createdAt: h.createdAt,
      found: !!mark
    }));
  }
})();
