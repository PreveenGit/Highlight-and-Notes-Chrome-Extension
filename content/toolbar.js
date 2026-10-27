// Floating toolbar shown next to selected text (pick a color) or a clicked
// highlight (recolor, copy, delete). It lives in a closed Shadow DOM so page CSS
// can't reach it.
(() => {
  const HL = globalThis.HL;

  const ICONS = {
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
    .icon svg { width: 16px; height: 16px; fill: currentColor; }
    button:focus-visible { outline: 2px solid #8ab4f8; outline-offset: 2px; }
  `;

  let host = null;
  let bar = null;
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
    // Keep the page selection alive while clicking toolbar buttons.
    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (button) onAction(button.dataset.action, button.dataset.color);
    });
    root.append(bar);
    document.documentElement.append(host);
  }

  // mode "create": color swatches for the current selection.
  // mode "edit": swatches to recolor plus copy and delete for a clicked highlight.
  function show(rect, { mode, color }) {
    ensure();
    bar.replaceChildren();
    for (const name of HL.COLOR_NAMES) {
      const swatch = button('color', `${mode === 'edit' ? 'Change to' : 'Highlight'} ${name}`);
      swatch.className = 'swatch' + (mode === 'edit' && name === color ? ' active' : '');
      swatch.dataset.color = name;
      swatch.style.background = HL.COLORS[name];
      bar.append(swatch);
    }
    if (mode === 'edit') {
      const sep = document.createElement('span');
      sep.className = 'sep';
      bar.append(sep, iconButton('copy', 'Copy text'), iconButton('delete', 'Remove highlight'));
    }
    bar.hidden = false;
    place(rect);
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
  }

  function isOpen() {
    return !!bar && !bar.hidden;
  }

  // True if the event happened inside the toolbar.
  function owns(event) {
    return !!host && event.composedPath().includes(host);
  }

  HL.toolbar = { init, show, hide, isOpen, owns };
})();
