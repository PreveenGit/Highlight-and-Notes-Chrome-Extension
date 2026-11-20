// Floating toolbar shown next to selected text (pick a color, or add a note) or a
// clicked highlight (recolor, note, copy, delete). It also hosts the note editor.
// It lives in a closed Shadow DOM so page CSS can't reach it.
(() => {
  const HL = globalThis.HL;

  const ICONS = {
    note: 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
  };

  const CSS = `
    :host { all: initial; }
    .bar {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      background: #202124;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      font: 12px/1 system-ui, sans-serif;
      user-select: none;
    }
    .bar[hidden] { display: none; }
    .bar.note-mode {
      flex-direction: column;
      align-items: stretch;
      padding: 8px;
    }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    .swatch {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.85);
      transition: transform 0.1s;
    }
    .swatch:hover { transform: scale(1.15); }
    .swatch.active { box-shadow: 0 0 0 2px #202124, 0 0 0 4px #8ab4f8; }
    .sep { width: 1px; height: 18px; background: #5f6368; }
    .icon {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      color: #e8eaed;
    }
    .icon:hover { background: #3c4043; }
    .icon.on { color: #fdd663; }
    .icon svg { width: 16px; height: 16px; fill: currentColor; }
    textarea {
      all: unset;
      box-sizing: border-box;
      display: block;
      width: 260px;
      min-height: 72px;
      max-height: 220px;
      padding: 6px 8px;
      border-radius: 6px;
      background: #303134;
      color: #e8eaed;
      font: 13px/1.4 system-ui, sans-serif;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      overflow-y: auto;
      resize: vertical;
      cursor: text;
      user-select: text;
    }
    textarea::placeholder { color: #9aa0a6; }
    textarea:focus { outline: 2px solid #8ab4f8; outline-offset: 0; }
    .row { display: flex; align-items: center; gap: 6px; }
    .hint { flex: 1; color: #9aa0a6; font-size: 11px; }
    .text-btn {
      padding: 5px 10px;
      border-radius: 6px;
      color: #e8eaed;
      font-weight: 600;
    }
    .text-btn:hover { background: #3c4043; }
    .text-btn.primary { background: #8ab4f8; color: #202124; }
    .text-btn.primary:hover { background: #aecbfa; }
    button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
  `;

  let host = null;
  let bar = null;
  let noteArea = null; // the note editor's textarea while it is open
  let onAction = () => {};

  function init(callback) {
    onAction = callback;
  }

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('hl-toolbar');
    host.style.cssText = 'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 2147483647 !important;';
    const root = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet]; // not blocked by a page's style-src CSP
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
    }
    bar = document.createElement('div');
    bar.className = 'bar';
    bar.hidden = true;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Highlight');
    // Keep the page selection alive while clicking toolbar buttons. The note box
    // still needs the default action to take focus and place the caret.
    bar.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
    });
    bar.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      const action = button.dataset.action;
      onAction(action, action === 'note-save' ? noteValue() : button.dataset.color);
    });
    root.append(bar);
    document.documentElement.append(host);
  }

  // mode "create": color swatches and a note button for the current selection.
  // mode "edit": swatches to recolor plus note, copy and delete for a clicked highlight.
  function show(rect, { mode, color, hasNote = false }) {
    ensure();
    noteArea = null;
    bar.className = 'bar';
    bar.replaceChildren();
    for (const name of HL.COLOR_NAMES) {
      const swatch = button('color', `${mode === 'edit' ? 'Change to' : 'Highlight'} ${name}`);
      swatch.className = 'swatch' + (mode === 'edit' && name === color ? ' active' : '');
      swatch.dataset.color = name;
      swatch.style.background = HL.COLORS[name];
      bar.append(swatch);
    }
    const sep = document.createElement('span');
    sep.className = 'sep';
    bar.append(sep);
    if (mode === 'edit') {
      const note = iconButton('note', hasNote ? 'Edit note' : 'Add note');
      note.classList.toggle('on', hasNote);
      bar.append(note, iconButton('copy', 'Copy text'), iconButton('delete', 'Remove highlight'));
    } else {
      bar.append(iconButton('note', 'Highlight and add a note'));
    }
    bar.hidden = false;
    place(rect);
  }

  // The note editor: a text box with Save and Cancel. Ctrl/Cmd+Enter saves and
  // Escape cancels.
  function showNote(rect, { text = '' } = {}) {
    ensure();
    bar.className = 'bar note-mode';
    bar.replaceChildren();

    noteArea = document.createElement('textarea');
    noteArea.value = text;
    noteArea.placeholder = 'Add a note…';
    noteArea.setAttribute('aria-label', 'Note');
    noteArea.addEventListener('keydown', (e) => {
      // Events leave the shadow root looking like they came from <hl-toolbar>, so
      // the page can't tell they are typing; stop them reaching its shortcuts.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onAction('note-cancel');
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onAction('note-save', noteValue());
      }
    });
    for (const type of ['keyup', 'keypress']) noteArea.addEventListener(type, (e) => e.stopPropagation());

    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵ to save' : 'Ctrl+Enter to save';
    const cancel = textButton('note-cancel', 'Cancel');
    const save = textButton('note-save', 'Save');
    save.classList.add('primary');
    const row = document.createElement('div');
    row.className = 'row';
    row.append(hint, cancel, save);

    bar.append(noteArea, row);
    bar.hidden = false;
    place(rect);
    noteArea.focus({ preventScroll: true });
    noteArea.setSelectionRange(text.length, text.length);
  }

  function noteValue() {
    return noteArea ? noteArea.value : '';
  }

  function button(action, label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.action = action;
    el.title = label;
    el.setAttribute('aria-label', label);
    return el;
  }

  function iconButton(action, label) {
    const el = button(action, label);
    el.className = 'icon';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[action]);
    svg.append(path);
    el.append(svg);
    return el;
  }

  function textButton(action, label) {
    const el = button(action, label);
    el.className = 'text-btn';
    el.textContent = label;
    return el;
  }

  // Above the target, or below it when there is no room; kept inside the viewport.
  function place(rect) {
    const gap = 8;
    const { width, height } = bar.getBoundingClientRect();
    let top = rect.top - height - gap;
    if (top < 4) top = rect.bottom + gap;
    top = Math.max(4, Math.min(top, window.innerHeight - height - 4));
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
    bar.style.top = `${top}px`;
    bar.style.left = `${left}px`;
  }

  function hide() {
    if (bar) bar.hidden = true;
    noteArea = null;
  }

  function isOpen() {
    return !!bar && !bar.hidden;
  }

  function isEditingNote() {
    return isOpen() && !!noteArea;
  }

  // Saves what was typed in the open note editor (used when clicking away).
  function commitNote() {
    if (isEditingNote()) onAction('note-save', noteValue());
  }

  // True if the event happened inside the toolbar.
  function owns(event) {
    return !!host && event.composedPath().includes(host);
  }

  HL.toolbar = { init, show, showNote, hide, isOpen, isEditingNote, commitNote, owns };
})();
