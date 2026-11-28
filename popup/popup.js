// Popup: this page's highlights at a glance, and the settings (on a screen of their
// own), including the user's own highlight colors. It talks to the page's content
// script, so it needs no "tabs" permission.
(async () => {
  const HL = globalThis.HL;
  const $ = (id) => document.getElementById(id);

  const ICONS = {
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let page = null;
  let clearArmed = false;
  let settings = await HL.getSettings();

  renderColors();
  $('showToolbar').checked = settings.showToolbar;
  renderShortcut();
  await refresh();

  function send(msg) {
    return chrome.tabs.sendMessage(tab.id, msg);
  }

  function svg(path) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    el.append(p);
    return el;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---- This page -----------------------------------------------------------

  async function refresh() {
    try {
      page = await send({ type: HL.MSG.LIST });
    } catch {
      page = null; // no content script on this tab
    }
    $('unavailable').hidden = !!page;
    $('page').hidden = !page;
    $('site').textContent = page ? HL.data.siteOf(page.url) : '';
    if (page) renderPage();
  }

  function renderPage() {
    const { highlights } = page;
    const n = highlights.length;
    const toLearn = highlights.filter((h) => h.learn).length;
    $('statHighlights').textContent = String(n);
    $('statNotes').textContent = String(highlights.filter((h) => h.note).length);
    $('statLearnCount').textContent = String(toLearn);
    $('statLearn').classList.toggle('on', toLearn > 0);

    $('empty').hidden = n > 0;
    $('list').hidden = n === 0;
    $('listHead').hidden = n === 0;
    $('copy').disabled = n === 0;
    $('clear').disabled = n === 0;

    const bookmark = highlights.find((h) => h.bookmark);
    $('jump').hidden = !bookmark;
    $('jump').disabled = !!bookmark && !bookmark.found;
    $('jump').title = bookmark && !bookmark.found ? "The bookmarked line isn't on the page right now" : 'Scroll to your bookmark';
    $('jump').dataset.id = bookmark ? bookmark.id : '';
    if (bookmark) {
      $('jumpText').textContent = `“${bookmark.text}”`;
      const when = HL.ago(bookmark.createdAt);
      $('jumpWhen').textContent = !bookmark.found ? 'Not on the page right now' : when ? `Saved ${when}` : '';
    }

    $('list').replaceChildren(...highlights.map(listItem));
  }

  // One highlight on the rail: a dot in its color, the text with its tags, the
  // note, and the Learn more question with Got it.
  function listItem(h) {
    const li = el('li', 'rail-item');
    li.classList.toggle('orphan', !h.found);
    li.style.setProperty('--dot', h.bookmark ? 'var(--accent)' : HL.colorValue(h.color));
    li.title = h.found ? 'Show on page' : '';

    const body = el('div', 'body');
    const text = el('span', 'text', h.text);
    if (!h.found) text.prepend(el('span', 'note', 'Not found on the page right now'));
    body.append(text);

    const tags = [];
    if (h.bookmark) tags.push(el('span', 'tag bookmark', 'Bookmark'));
    if (h.learnedAt) tags.push(el('span', 'tag learned', 'Learned'));
    if (tags.length) {
      const row = el('span', 'tags');
      row.append(...tags);
      body.append(row);
    }

    if (h.note) body.append(el('span', 'user-note', h.note));

    if (h.learn) {
      const box = el('div', 'learn-row');
      const question = el('span', 'question');
      question.append(el('span', 'q-mark', '?'), el('span', h.question ? '' : 'muted', h.question || 'Marked to learn more'));
      const got = el('button', 'got');
      got.type = 'button';
      got.title = 'Got it: move to Learned';
      got.append(svg(ICONS.check), el('span', '', 'Got it'));
      got.addEventListener('click', async (e) => {
        e.stopPropagation();
        await send({ type: HL.MSG.SET_LEARN, id: h.id, state: 'learned' }).catch(() => null);
        await refresh();
      });
      box.append(question, got);
      body.append(box);
    }

    const label = h.bookmark ? 'Remove bookmark' : 'Remove highlight';
    const remove = el('button', 'remove');
    remove.type = 'button';
    remove.title = label;
    remove.setAttribute('aria-label', label);
    remove.append(svg(ICONS.close));
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      await send({ type: HL.MSG.DELETE, id: h.id });
      await refresh();
    });

    if (h.found) li.addEventListener('click', () => send({ type: HL.MSG.SCROLL_TO, id: h.id }));
    li.append(body, remove);
    return li;
  }

  // Scrolls the page to its bookmark and closes the popup so the line is in view.
  $('jump').addEventListener('click', async () => {
    const res = await send({ type: HL.MSG.SCROLL_TO, id: $('jump').dataset.id }).catch(() => null);
    if (res && res.ok) window.close();
    else await refresh();
  });

  // The To learn tile opens the To learn list in the library.
  $('statLearn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html#learn') });
    window.close();
  });

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(HL.data.toMarkdown([{ ...page, title: page.title || page.url }]));
    flashLabel($('copy'), 'Copied');
  });

  $('sidePanel').addEventListener('click', async () => {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  });

  $('library').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
    window.close();
  });

  // Two clicks to clear, so one stray click can't wipe a page.
  $('clear').addEventListener('click', async () => {
    const label = $('clear').querySelector('span');
    if (!clearArmed) {
      clearArmed = true;
      label.textContent = 'Click again';
      setTimeout(() => {
        clearArmed = false;
        label.textContent = 'Clear page';
      }, 3000);
      return;
    }
    clearArmed = false;
    label.textContent = 'Clear page';
    await send({ type: HL.MSG.CLEAR });
    await refresh();
  });

  function flashLabel(button, text) {
    const label = button.querySelector('span');
    const original = label.textContent;
    label.textContent = text;
    setTimeout(() => (label.textContent = original), 1200);
  }

  // ---- Settings screen -----------------------------------------------------

  function showSettings(open) {
    $('mainView').hidden = open;
    $('settingsView').hidden = !open;
    (open ? $('closeSettings') : $('openSettings')).focus();
    if (!open) closeAddColor();
  }

  $('openSettings').addEventListener('click', () => showSettings(true));
  $('closeSettings').addEventListener('click', () => showSettings(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('settingsView').hidden && $('addColor').hidden) {
      e.preventDefault();
      showSettings(false);
    }
  });

  // ---- Colors --------------------------------------------------------------

  async function saveSettings(patch) {
    settings = HL.cleanSettings(await HL.setSettings(patch));
    renderColors();
  }

  // The palette as radio buttons (the checked one is the default color), with a
  // remove button on custom colors and an add button while there's room.
  function renderColors() {
    const custom = HL.customColors(settings);
    const items = HL.palette(settings).map((color) => {
      const label = HL.colorLabel(color);
      const b = el('button', 'swatch');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(color === settings.defaultColor));
      b.setAttribute('aria-label', label);
      b.title = label;
      b.style.background = HL.colorValue(color);
      b.style.color = HL.textOn(color); // the check mark
      b.addEventListener('click', () => saveSettings({ defaultColor: color }));
      if (!custom.includes(color)) return b;

      const remove = el('button', 'swatch-remove');
      remove.type = 'button';
      remove.title = `Remove ${label}`;
      remove.setAttribute('aria-label', `Remove ${label}`);
      remove.append(svg(ICONS.close));
      remove.addEventListener('click', () => removeColor(color));
      const wrap = el('span', 'swatch-wrap');
      wrap.append(b, remove);
      return wrap;
    });

    if (custom.length < HL.MAX_CUSTOM_COLORS) {
      const add = el('button', 'swatch add');
      add.type = 'button';
      add.id = 'addButton';
      add.title = 'Add your own color';
      add.setAttribute('aria-label', 'Add your own color');
      add.setAttribute('aria-expanded', String(!$('addColor').hidden));
      add.append(svg(ICONS.plus));
      add.addEventListener('click', () => ($('addColor').hidden ? openAddColor() : closeAddColor()));
      items.push(add);
    }
    $('colors').replaceChildren(...items);
  }

  // Highlights already in this color keep it; only the palette loses it.
  function removeColor(color) {
    const patch = { customColors: HL.customColors(settings).filter((c) => c !== color) };
    if (settings.defaultColor === color) patch.defaultColor = HL.DEFAULT_SETTINGS.defaultColor;
    saveSettings(patch);
  }

  function paletteValues() {
    return HL.palette(settings).map(HL.colorValue);
  }

  function openAddColor() {
    const taken = paletteValues();
    const choices = HL.SUGGESTED_COLORS.filter((c) => !taken.includes(c));
    $('suggestions').replaceChildren(
      ...choices.map((color) => {
        const b = el('button');
        b.type = 'button';
        b.dataset.color = color;
        b.title = color.toUpperCase();
        b.setAttribute('aria-label', `Use ${color.toUpperCase()}`);
        b.setAttribute('aria-pressed', 'false');
        b.style.background = color;
        b.addEventListener('click', () => setDraft(color));
        return b;
      })
    );
    $('suggestions').hidden = !choices.length;
    $('addColor').hidden = false;
    setDraft(choices[0] || '#c4b5fd');
    $('addButton')?.setAttribute('aria-expanded', 'true');
    $('colorCode').focus();
    $('colorCode').select();
  }

  function closeAddColor() {
    $('addColor').hidden = true;
    showColorError('');
    $('addButton')?.setAttribute('aria-expanded', 'false');
  }

  // Shows `color` in the picker, the code box and the suggestions.
  function setDraft(color, { typed = false } = {}) {
    const hex = HL.parseHex(color);
    if (hex) $('colorPicker').value = hex;
    if (!typed) $('colorCode').value = (hex || color).toUpperCase();
    for (const b of $('suggestions').children) b.setAttribute('aria-pressed', String(b.dataset.color === hex));
    showColorError('');
  }

  function showColorError(message) {
    $('colorError').textContent = message;
    $('colorError').hidden = !message;
    $('colorCode').setAttribute('aria-invalid', String(!!message));
  }

  $('colorPicker').addEventListener('input', (e) => setDraft(e.target.value));
  $('colorCode').addEventListener('input', (e) => setDraft(e.target.value, { typed: true }));
  $('cancelColor').addEventListener('click', closeAddColor);
  $('addColor').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeAddColor();
    $('addButton')?.focus();
  });

  $('addColor').addEventListener('submit', async (e) => {
    e.preventDefault();
    const hex = HL.parseHex($('colorCode').value);
    const custom = HL.customColors(settings);
    if (!hex) return showColorError('Enter a color code like #C4B5FD.');
    if (paletteValues().includes(hex)) return showColorError("That color's already in your palette.");
    if (custom.length >= HL.MAX_CUSTOM_COLORS) return showColorError(`You can add up to ${HL.MAX_CUSTOM_COLORS} colors.`);
    $('addColor').hidden = true;
    await saveSettings({ customColors: [...custom, hex], defaultColor: hex }); // a new color becomes the default
  });

  // ---- Other settings ------------------------------------------------------

  $('showToolbar').addEventListener('change', async (e) => {
    settings = HL.cleanSettings(await HL.setSettings({ showToolbar: e.target.checked }));
  });

  async function renderShortcut() {
    const commands = await chrome.commands.getAll();
    const command = commands.find((c) => c.name === HL.MSG.HIGHLIGHT_SELECTION);
    if (command && command.shortcut) $('shortcut').textContent = command.shortcut;
  }

  $('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
})();
