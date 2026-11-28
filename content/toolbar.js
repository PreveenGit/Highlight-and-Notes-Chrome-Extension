// Floating toolbar shown next to selected text (pick a color, add a note, bookmark
// the line, or mark it to learn more) or a clicked highlight (recolor, note, learn
// more / got it, copy, delete). It also hosts the note editor.
// It lives in a closed Shadow DOM so page CSS can't reach it.
(() => {
  const HL = globalThis.HL;

  const ICONS = {
    bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
    learn: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    question:
      'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
    note: 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
  };

  // A dark, frosted pill that reads well on light and dark pages. Icon buttons get
  // a quick label on hover (data-tip), shown on the side away from the text.
  const CSS = `
    :host { all: initial; }
    .bar {
      --shift: 6px;
      position: fixed;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 5px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 999px;
      background: rgba(28, 29, 32, 0.9);
      -webkit-backdrop-filter: blur(14px) saturate(160%);
      backdrop-filter: blur(14px) saturate(160%);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.22);
      color: #e8eaed;
      font: 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      user-select: none;
      animation: hl-in 0.14s ease-out;
    }
    .bar[data-side='below'] { --shift: -6px; }
    .bar[hidden] { display: none; }
    @keyframes hl-in {
      from { opacity: 0; transform: translateY(var(--shift)) scale(0.97); }
    }
    .bar.note-mode {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      padding: 10px;
      border-radius: 16px;
    }
    button { all: unset; box-sizing: border-box; cursor: pointer; }
    button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
    .swatch {
      width: 20px;
      height: 20px;
      margin: 0 3px;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
      transition: transform 0.12s ease-out, box-shadow 0.12s;
    }
    .swatch:first-child { margin-left: 5px; }
    .swatch:hover { transform: scale(1.18); }
    .swatch:active { transform: scale(0.94); }
    .swatch.active { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18), 0 0 0 2px rgba(28, 29, 32, 0.9), 0 0 0 4px #fff; }
    .sep { width: 1px; height: 20px; margin: 0 5px; background: rgba(255, 255, 255, 0.14); }
    .icon {
      position: relative;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      color: #e8eaed;
      transition: background-color 0.12s, transform 0.12s ease-out;
    }
    .icon:hover { background: rgba(255, 255, 255, 0.12); }
    .icon:active { transform: scale(0.9); }
    .icon.on { color: #fdd663; }
    .icon[data-action='bookmark'] { color: #8ab4f8; }
    .icon[data-action='learn'],
    .icon[data-action='question'] { color: #d7aefb; }
    .note-title {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 2px;
      color: #bdc1c6;
      font: 600 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
      letter-spacing: 0.02em;
    }
    .note-title svg { width: 14px; height: 14px; fill: currentColor; }
    .bar.question .note-title { color: #d7aefb; }
    .bar.question textarea:focus { border-color: #d7aefb; box-shadow: 0 0 0 3px rgba(215, 174, 251, 0.25); }
    .bar.question .text-btn.primary { background: #d7aefb; }
    .bar.question .text-btn.primary:hover { background: #e7cdfd; }
    .icon[data-action='delete']:hover { color: #f28b82; background: rgba(242, 139, 130, 0.14); }
    .icon svg { width: 18px; height: 18px; fill: currentColor; }
    .icon::after {
      content: attr(data-tip);
      position: absolute;
      left: 50%;
      bottom: calc(100% + 12px);
      padding: 6px 9px;
      border-radius: 7px;
      background: #0f1012;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      color: #fff;
      font: 500 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif;
      white-space: nowrap;
      opacity: 0;
      transform: translate(-50%, 3px);
      transition: opacity 0.12s, transform 0.12s;
      pointer-events: none;
    }
    .bar[data-side='below'] .icon::after { bottom: auto; top: calc(100% + 12px); transform: translate(-50%, -3px); }
    .icon:last-child::after { left: auto; right: 0; transform: translateY(3px); }
    .bar[data-side='below'] .icon:last-child::after { transform: translateY(-3px); }
    .icon:hover::after,
    .icon:focus-visible::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.3s; }
    .icon:last-child:hover::after,
    .icon:last-child:focus-visible::after { transform: none; }
    textarea {
      all: unset;
      box-sizing: border-box;
      display: block;
      width: 280px;
      min-height: 80px;
      max-height: 220px;
      padding: 9px 11px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.06);
      color: #e8eaed;
      font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      overflow-y: auto;
      resize: vertical;
      cursor: text;
      user-select: text;
      transition: border-color 0.12s, box-shadow 0.12s;
    }
    textarea::placeholder { color: #9aa0a6; }
    textarea:focus { border-color: #8ab4f8; box-shadow: 0 0 0 3px rgba(138, 180, 248, 0.25); }
    .row { display: flex; align-items: center; gap: 6px; }
    .hint { flex: 1; padding-left: 2px; color: #9aa0a6; font-size: 11px; }
    .text-btn {
      padding: 7px 14px;
      border-radius: 999px;
      color: #e8eaed;
      font-weight: 600;
      transition: background-color 0.12s, transform 0.12s ease-out;
    }
    .text-btn:hover { background: rgba(255, 255, 255, 0.12); }
    .text-btn:active { transform: scale(0.96); }
    .text-btn.primary { background: #8ab4f8; color: #1c1d20; }
    .text-btn.primary:hover { background: #aecbfa; }
    @media (prefers-reduced-motion: reduce) {
      .bar, .swatch, .icon, .icon::after, .text-btn, textarea { animation: none; transition: none; }
    }
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

  // mode "create": color swatches, plus note, bookmark and learn-more buttons for the
  //   current selection.
  // mode "edit": swatches to recolor plus note, learn more / got it, copy and delete
  //   for a clicked highlight. A clicked bookmark has no color, so no swatches.
  // `colors` is the palette to offer: built-in names and the user's custom "#rrggbb".
  function show(rect, { mode, color, colors = HL.COLOR_NAMES, hasNote = false, bookmark = false, learn = false, hasQuestion = false }) {
    ensure();
    noteArea = null;
    bar.className = 'bar';
    bar.replaceChildren();
    if (!(mode === 'edit' && bookmark)) {
      for (const name of colors) {
        const swatch = button('color', `${mode === 'edit' ? 'Change to' : 'Highlight'} ${HL.colorLabel(name)}`);
        swatch.className = 'swatch' + (mode === 'edit' && name === color ? ' active' : '');
        swatch.dataset.color = name;
        swatch.style.background = HL.colorValue(name);
        bar.append(swatch);
      }
      const sep = document.createElement('span');
      sep.className = 'sep';
      bar.append(sep);
    }
    if (mode === 'edit') {
      const note = iconButton('note', hasNote ? 'Edit note' : 'Add note');
      note.classList.toggle('on', hasNote);
      bar.append(
        note,
        ...(learn
          ? [
              iconButton('question', hasQuestion ? 'Edit your question' : 'Add your question'),
              iconButton('learn', 'Got it: move to Learned', 'check')
            ]
          : [iconButton('learn', 'Mark to learn more')]),
        iconButton('copy', 'Copy text'),
        iconButton('delete', bookmark ? 'Remove bookmark' : 'Remove highlight')
      );
    } else {
      bar.append(
        iconButton('note', 'Highlight and add a note'),
        iconButton('bookmark', 'Bookmark this line (one per page)'),
        iconButton('learn', 'Highlight to learn more')
      );
    }
    bar.hidden = false;
    place(rect);
  }

  // The text box for a note or a Learn more question (kind 'question' is purple),
  // with a title line, Save and Cancel. Ctrl/Cmd+Enter saves and Escape cancels.
  function showNote(rect, { text = '', placeholder = 'Add a note…', title = 'Note', kind = 'note' } = {}) {
    ensure();
    bar.className = `bar note-mode ${kind === 'question' ? 'question' : ''}`.trim();
    bar.replaceChildren();

    const heading = document.createElement('div');
    heading.className = 'note-title';
    const headingIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    headingIcon.setAttribute('viewBox', '0 0 24 24');
    const headingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    headingPath.setAttribute('d', ICONS[kind === 'question' ? 'learn' : 'note']);
    headingIcon.append(headingPath);
    const headingText = document.createElement('span');
    headingText.textContent = title;
    heading.append(headingIcon, headingText);

    noteArea = document.createElement('textarea');
    noteArea.value = text;
    noteArea.placeholder = placeholder;
    noteArea.setAttribute('aria-label', title);
    // content/guard.js normally stops these keys at the window, before the page sees
    // them, and calls handleKey itself. These listeners are the fallback for when it
    // isn't loaded.
    noteArea.addEventListener('keydown', (e) => {
      e.stopPropagation();
      handleKey(e);
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

    bar.append(heading, noteArea, row);
    bar.hidden = false;
    place(rect);
    noteArea.focus({ preventScroll: true });
    noteArea.setSelectionRange(text.length, text.length);
  }

  function noteValue() {
    return noteArea ? noteArea.value : '';
  }

  // The note editor's shortcuts: Escape cancels, Ctrl/Cmd+Enter saves.
  function handleKey(e) {
    if (!isEditingNote()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onAction('note-cancel');
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onAction('note-save', noteValue());
    }
  }

  function button(action, label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.action = action;
    el.title = label;
    el.setAttribute('aria-label', label);
    return el;
  }

  // The label shows as a quick tooltip (CSS, from data-tip) instead of the slow
  // native one.
  function iconButton(action, label, icon = action) {
    const el = button(action, label);
    el.className = 'icon';
    el.removeAttribute('title');
    el.dataset.tip = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[icon]);
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
    const below = top < 4;
    if (below) top = rect.bottom + gap;
    top = Math.max(4, Math.min(top, window.innerHeight - height - 4));
    bar.dataset.side = below ? 'below' : 'above'; // tooltips go on the side away from the text
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

  HL.toolbar = { init, show, showNote, hide, isOpen, isEditingNote, commitNote, handleKey, owns };
})();
