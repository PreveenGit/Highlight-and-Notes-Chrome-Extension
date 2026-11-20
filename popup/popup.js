// Popup: lists the current page's highlights and holds the settings.
// It talks to the page's content script, so it needs no "tabs" permission.
(async () => {
  const HL = globalThis.HL;
  const $ = (id) => document.getElementById(id);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let page = null;
  let clearArmed = false;

  renderSettings();
  renderShortcut();
  await refresh();

  function send(msg) {
    return chrome.tabs.sendMessage(tab.id, msg);
  }

  async function refresh() {
    try {
      page = await send({ type: HL.MSG.LIST });
    } catch {
      page = null; // no content script on this tab
    }
    $('unavailable').hidden = !!page;
    $('page').hidden = !page;
    if (page) renderList();
  }

  function renderList() {
    const { highlights } = page;
    const n = highlights.length;
    $('count').textContent = n ? `${n} highlight${n === 1 ? '' : 's'}` : '';
    $('empty').hidden = n > 0;
    $('copy').disabled = n === 0;
    $('clear').disabled = n === 0;

    $('list').replaceChildren(
      ...highlights.map((h) => {
        const li = document.createElement('li');
        li.classList.toggle('orphan', !h.found);
        li.title = h.found ? 'Show on page' : '';

        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = HL.COLORS[h.color] || HL.COLORS.yellow;

        const text = document.createElement('span');
        text.className = 'text';
        text.textContent = h.text;
        if (!h.found) {
          const note = document.createElement('span');
          note.className = 'note';
          note.textContent = 'Not found on the page right now';
          text.prepend(note);
        }

        const body = document.createElement('div');
        body.className = 'body';
        body.append(text);
        if (h.note) {
          const userNote = document.createElement('span');
          userNote.className = 'user-note';
          userNote.textContent = h.note;
          body.append(userNote);
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '✕';
        remove.title = 'Remove highlight';
        remove.setAttribute('aria-label', 'Remove highlight');
        remove.addEventListener('click', async (e) => {
          e.stopPropagation();
          await send({ type: HL.MSG.DELETE, id: h.id });
          await refresh();
        });

        if (h.found) li.addEventListener('click', () => send({ type: HL.MSG.SCROLL_TO, id: h.id }));
        li.append(dot, body, remove);
        return li;
      })
    );
  }

  $('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(HL.data.toMarkdown([{ ...page, title: page.title || page.url }]));
    flashLabel($('copy'), 'Copied!');
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
    const button = $('clear');
    if (!clearArmed) {
      clearArmed = true;
      button.textContent = 'Click again to clear';
      setTimeout(() => {
        clearArmed = false;
        button.textContent = 'Clear page';
      }, 3000);
      return;
    }
    clearArmed = false;
    button.textContent = 'Clear page';
    await send({ type: HL.MSG.CLEAR });
    await refresh();
  });

  function flashLabel(button, label) {
    const original = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = original), 1200);
  }

  async function renderSettings() {
    const settings = await HL.getSettings();
    const colors = $('colors');
    colors.replaceChildren(
      ...HL.COLOR_NAMES.map((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(name === settings.defaultColor));
        b.setAttribute('aria-label', name);
        b.title = name;
        b.style.background = HL.COLORS[name];
        b.addEventListener('click', async () => {
          await HL.setSettings({ defaultColor: name });
          renderSettings();
        });
        return b;
      })
    );
    $('showToolbar').checked = settings.showToolbar;
  }

  $('showToolbar').addEventListener('change', (e) => HL.setSettings({ showToolbar: e.target.checked }));

  async function renderShortcut() {
    const commands = await chrome.commands.getAll();
    const command = commands.find((c) => c.name === HL.MSG.HIGHLIGHT_SELECTION);
    if (command && command.shortcut) $('shortcut').textContent = command.shortcut;
  }

  $('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
})();
