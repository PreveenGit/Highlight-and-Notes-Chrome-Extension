// Library: every highlight on every page. The same page runs in Chrome's side
// panel and as a full tab. It reads storage directly; edits go through
// HL.mutatePage and reach open tabs through their storage.onChanged sync.
(async () => {
  const HL = globalThis.HL;
  const $ = (id) => document.getElementById(id);
  const TIMELINE_PAGE = 200;
  const LEARN_PROMPT = 'What do you want to learn about this?'; // note box placeholder

  const ICONS = {
    chevron: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
    learn: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    note: 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
    palette:
      'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'
  };

  // getCurrent() returns nothing in the side panel.
  const inTab = !!(await chrome.tabs.getCurrent());
  document.body.classList.toggle('in-tab', inTab);
  $('viewPage').hidden = inTab;
  $('openTab').hidden = inTab;

  const state = {
    view: inTab ? 'pages' : 'page',
    query: '',
    colors: new Set(),
    sort: 'newest',
    collapsed: new Set(),
    timelineLimit: TIMELINE_PAGE,
    editing: null // note being edited: { key, id, draft }; survives re-renders
  };
  let pages = []; // every stored page (HL.data.toPages)
  let settings = HL.cleanSettings(); // for the palette (custom colors)
  let current = null; // side panel: the active tab's page, as its content script reports it

  // ---- Data ----------------------------------------------------------------

  async function reload() {
    const all = await chrome.storage.local.get(null);
    pages = HL.data.toPages(all);
    settings = HL.cleanSettings(all[HL.SETTINGS_KEY]);
    if (!inTab) current = await loadCurrent();
    buildColorChips();
    render();
  }

  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 250);
  }

  async function loadCurrent() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    const res = await send(tab.id, { type: HL.MSG.LIST });
    if (!res || !Array.isArray(res.highlights)) return { tabId: tab.id, unavailable: true };
    return { tabId: tab.id, key: HL.pageKey(res.url), url: res.url, title: res.title, highlights: res.highlights };
  }

  function send(tabId, msg) {
    return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
  }

  // The current tab's page in the same shape as a stored page.
  function currentPage() {
    const stored = pages.find((p) => p.key === current.key);
    return {
      key: current.key,
      url: current.url,
      title: current.title || current.url,
      site: HL.data.siteOf(current.url),
      highlights: current.highlights,
      firstAt: stored ? stored.firstAt : 0,
      lastAt: stored ? stored.lastAt : 0
    };
  }

  function isCurrent(key) {
    return !!current && !current.unavailable && current.key === key;
  }

  function findPage(key) {
    if (state.view === 'page' && isCurrent(key)) return currentPage();
    return pages.find((p) => p.key === key);
  }

  // In the "To learn" view only highlights marked "learn more" are shown (and exported).
  function filters() {
    return { query: state.query, colors: [...state.colors], sort: state.sort, learn: state.view === 'learn' };
  }

  // The page as currently shown, i.e. with search and color filters applied.
  function visiblePage(key) {
    const page = findPage(key);
    return page && HL.data.filterAndSort([page], filters()).pages[0];
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    const total = pages.reduce((n, p) => n + p.highlights.length, 0);
    $('summary').textContent = total ? `${total} highlight${plural(total)} · ${pages.length} page${plural(pages.length)}` : '';
    for (const b of document.querySelectorAll('.views button')) {
      b.setAttribute('aria-selected', String(b.dataset.view === state.view));
    }
    $('sort').hidden = state.view === 'page';
    const toLearn = learnCount();
    document.querySelector('.views [data-view="learn"]').textContent = toLearn ? `To learn (${toLearn})` : 'To learn';
    const view =
      state.view === 'page' ? renderCurrent()
      : state.view === 'pages' ? renderPages()
      : state.view === 'learn' ? renderLearn()
      : renderTimeline();
    const editor = editorState();
    $('content').replaceChildren(...view);
    restoreEditor(editor);
  }

  // Re-renders happen often (storage changes, tab switches, window focus), so the
  // open note editor keeps its focus and caret across them.
  function editorState() {
    const area = $('content').querySelector('.note-editor textarea');
    if (!area) return null;
    return { focused: document.activeElement === area, start: area.selectionStart, end: area.selectionEnd, scroll: area.scrollTop };
  }

  function restoreEditor(before) {
    const area = $('content').querySelector('.note-editor textarea');
    if (!area) return;
    if (!before) {
      // Just opened.
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    } else if (before.focused) {
      area.focus({ preventScroll: true });
      area.setSelectionRange(before.start, before.end);
      area.scrollTop = before.scroll;
    }
  }

  function renderCurrent() {
    if (!current || current.unavailable) {
      return [
        empty(
          "Highlighting isn't available on this page. Chrome doesn't let extensions run on chrome:// pages, the Web Store or the PDF viewer. If you just installed the extension, reload the page."
        )
      ];
    }
    const page = currentPage();
    if (!page.highlights.length) return [empty('No highlights on this page yet. Select some text to start.')];
    const shown = HL.data.filterAndSort([page], filters()).pages[0];
    if (!shown) return [pageHead(page, 0), empty('No highlights match your search.')];
    return [pageHead(page, shown.highlights.length), itemList(shown.highlights, page, false)];
  }

  function renderPages() {
    if (!pages.length) return [empty('No highlights yet. Select text on any page and pick a color.')];
    const shown = HL.data.filterAndSort(pages, filters()).pages;
    if (!shown.length) return [empty('No highlights match your search.')];
    return shown.map(pageCard);
  }

  function renderTimeline() {
    if (!pages.length) return [empty('No highlights yet. Select text on any page and pick a color.')];
    const { timeline } = HL.data.filterAndSort(pages, filters());
    if (!timeline.length) return [empty('No highlights match your search.')];
    return timelineList(timeline);
  }

  // Every highlight marked "learn more", on any page, as a timeline.
  function renderLearn() {
    if (!learnCount()) {
      return [
        empty(
          'Nothing marked to learn yet. Select text and click the graduation-cap button in the toolbar, or click a highlight and mark it to learn more.'
        )
      ];
    }
    const { timeline } = HL.data.filterAndSort(pages, filters());
    if (!timeline.length) return [empty('Nothing to learn matches your search.')];
    return timelineList(timeline);
  }

  function learnCount() {
    return pages.reduce((n, p) => n + p.highlights.filter((h) => h.learn).length, 0);
  }

  function timelineList(timeline) {
    const list = el('ul', 'items');
    list.append(...timeline.slice(0, state.timelineLimit).map(({ highlight, page }) => item(highlight, page, true)));
    const box = el('div', 'timeline');
    box.append(list);
    const out = [box];
    const left = timeline.length - state.timelineLimit;
    if (left > 0) {
      const more = el('button', 'more');
      more.type = 'button';
      more.dataset.action = 'more';
      more.textContent = `Show more (${left} left)`;
      out.push(more);
    }
    return out;
  }

  // Heading for the "This page" view.
  function pageHead(page, shownCount) {
    const head = el('div', 'page-head');
    head.dataset.key = page.key;
    const title = el('span', 'title');
    title.textContent = page.title;
    title.title = page.url;
    head.append(title);
    if (shownCount) {
      head.append(
        iconButton('copy', 'Copy as Markdown', 'copy-page'),
        iconButton('delete', `Delete ${shownCount} highlight${plural(shownCount)}`, 'delete-page')
      );
    }
    return head;
  }

  function pageCard(page) {
    const collapsed = state.collapsed.has(page.key);
    const card = el('section', 'card');
    card.dataset.key = page.key;
    card.classList.toggle('current', isCurrent(page.key));
    card.classList.toggle('collapsed', collapsed);

    const head = el('div', 'card-head');
    const toggle = iconButton('chevron', collapsed ? 'Expand' : 'Collapse', 'toggle');
    toggle.classList.add('toggle');
    toggle.setAttribute('aria-expanded', String(!collapsed));

    const title = el('div', 'card-title');
    const link = el('a');
    link.href = page.url;
    link.title = page.url;
    link.dataset.action = 'open-page';
    appendWithHits(link, page.title, HL.data.searchTerms(state.query));
    const meta = el('span', 'meta muted');
    if (isCurrent(page.key)) {
      const badge = el('span', 'badge');
      badge.textContent = 'Current tab';
      meta.append(badge);
    }
    const n = page.highlights.length;
    meta.append([page.site, `${n} highlight${plural(n)}`, ago(page.lastAt)].filter(Boolean).join(' · '));
    title.append(link, meta);

    head.append(
      toggle,
      favicon(page),
      title,
      iconButton('copy', 'Copy as Markdown', 'copy-page'),
      iconButton('delete', `Delete ${n} highlight${plural(n)}`, 'delete-page')
    );
    card.append(head, itemList(page.highlights, page, false));
    return card;
  }

  function itemList(highlights, page, showPage) {
    const list = el('ul', 'items');
    list.append(...highlights.map((h) => item(h, page, showPage)));
    if (state.view !== 'page') return list;
    const box = el('div', 'timeline');
    box.append(list);
    return box;
  }

  function item(h, page, showPage) {
    const orphan = h.found === false; // only known in the "This page" view
    const li = el('li', 'item');
    li.dataset.key = page.key;
    li.dataset.id = h.id;
    li.classList.toggle('orphan', orphan);
    li.classList.toggle('bookmark', !!h.bookmark);

    const bar = el('span', 'bar');
    bar.style.background = h.bookmark ? 'var(--accent)' : HL.colorValue(h.color);

    const terms = HL.data.searchTerms(state.query);
    const note = HL.noteOf(h);
    const editing = !!state.editing && state.editing.id === h.id && state.editing.key === page.key;

    const main = el('div', 'item-main');
    main.dataset.action = 'open';
    main.tabIndex = 0;
    main.setAttribute('role', 'button');
    main.title = orphan ? '' : isCurrent(page.key) ? 'Show on page' : 'Open the page and show';
    const text = el('p', 'text');
    appendWithHits(text, String(h.text || ''), terms);
    main.append(text);
    if (note && !editing) {
      const noteEl = el('p', 'user-note');
      appendWithHits(noteEl, note, terms);
      main.append(noteEl);
    }
    const meta = el('span', 'meta');
    if (h.bookmark) {
      const tag = el('span', 'bookmark-tag');
      tag.textContent = 'Bookmark';
      meta.append(tag);
    }
    if (h.learn) {
      const tag = el('span', 'learn-tag');
      tag.textContent = 'Learn more';
      meta.append(tag);
    }
    meta.append(
      [
        showPage ? page.title : '',
        showPage ? page.site : '',
        orphan ? 'Not found on the page right now' : ago(h.createdAt)
      ]
        .filter(Boolean)
        .join(' · ')
    );
    main.append(meta);

    // The editor sits outside .item-main, which is itself a button.
    const body = el('div', 'item-body');
    body.append(main);
    if (editing) body.append(noteEditor());

    const actions = el('div', 'item-actions');
    const noteButton = iconButton('note', note ? 'Edit note' : 'Add note', 'note');
    noteButton.classList.toggle('on', !!note);
    const learnButton = h.learn
      ? iconButton('check', 'Got it: clear Learn more', 'learn')
      : iconButton('learn', 'Mark to learn more', 'learn');
    learnButton.classList.toggle('on', !!h.learn);
    actions.append(
      noteButton,
      learnButton,
      ...(h.bookmark ? [] : [iconButton('palette', 'Change color', 'pick')]), // bookmarks have no color
      iconButton('copy', 'Copy text', 'copy'),
      iconButton('delete', h.bookmark ? 'Delete bookmark' : 'Delete highlight', 'delete')
    );

    const swatches = el('div', 'swatches');
    const choices = HL.palette(settings);
    if (!h.bookmark && HL.isColor(h.color) && !choices.includes(h.color)) choices.push(h.color); // a removed custom color
    for (const name of choices) {
      const b = el('button');
      b.type = 'button';
      b.dataset.action = 'color';
      b.dataset.color = name;
      b.title = HL.colorLabel(name);
      b.setAttribute('aria-label', `Change to ${HL.colorLabel(name)}`);
      b.setAttribute('aria-current', String(name === h.color));
      b.style.background = HL.colorValue(name);
      swatches.append(b);
    }

    li.append(bar, body, actions, swatches);
    return li;
  }

  function noteEditor() {
    const box = el('div', 'note-editor');
    box.dataset.action = 'noop'; // clicks inside must not open the highlight
    const area = el('textarea');
    area.value = state.editing.draft;
    area.rows = 3;
    area.placeholder = state.editing.placeholder || 'Add a note…';
    area.setAttribute('aria-label', 'Note');
    area.addEventListener('input', () => {
      if (state.editing) state.editing.draft = area.value;
    });
    const row = el('div', 'note-row');
    const hint = el('span', 'hint muted');
    hint.textContent = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵ to save' : 'Ctrl+Enter to save';
    const cancel = textButton('Cancel', 'note-cancel');
    const save = textButton('Save', 'note-save');
    save.classList.add('primary');
    row.append(hint, cancel, save);
    box.append(area, row);
    return box;
  }

  function textButton(label, action) {
    const b = el('button', 'text-btn');
    b.type = 'button';
    b.textContent = label;
    b.dataset.action = action;
    return b;
  }

  // Sets `parent`'s text, wrapping search matches in <mark class="hit">.
  function appendWithHits(parent, text, terms) {
    if (!terms.length) {
      parent.textContent = text;
      return;
    }
    const pattern = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(text.slice(last, match.index));
      const hit = el('mark', 'hit');
      hit.textContent = match[0];
      parent.append(hit);
      last = match.index + match[0].length;
    }
    parent.append(text.slice(last));
  }

  function favicon(page) {
    const img = el('img', 'favicon');
    img.alt = '';
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', page.url);
    url.searchParams.set('size', '32');
    img.src = url.href;
    img.addEventListener(
      'error',
      () => {
        const letter = el('span', 'favicon avatar');
        letter.textContent = (page.site || '?').charAt(0);
        img.replaceWith(letter);
      },
      { once: true }
    );
    return img;
  }

  // Filter chips: the palette, plus any other color still used by a highlight
  // (a custom color since removed from the palette).
  function buildColorChips() {
    const colors = HL.palette(settings);
    for (const page of pages) {
      for (const h of page.highlights) {
        if (!h.bookmark && HL.isColor(h.color) && !colors.includes(h.color)) colors.push(h.color);
      }
    }
    for (const c of state.colors) if (!colors.includes(c)) state.colors.delete(c);
    $('colors').replaceChildren(
      ...colors.map((name) => {
        const label = HL.colorLabel(name);
        const b = el('button');
        b.type = 'button';
        b.dataset.color = name;
        b.title = `Only ${label}`;
        b.setAttribute('aria-label', `Show ${label} highlights`);
        b.setAttribute('aria-pressed', String(state.colors.has(name)));
        b.style.background = HL.colorValue(name);
        return b;
      })
    );
    $('colors').classList.toggle('filtering', state.colors.size > 0);
  }

  function iconButton(icon, label, action) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.dataset.action = action;
    b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICONS[icon]}"/></svg>`;
    return b;
  }

  function empty(message) {
    const p = el('p', 'empty');
    p.textContent = message;
    return p;
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function ago(time) {
    return HL.ago(time);
  }

  function plural(n) {
    return n === 1 ? '' : 's';
  }

  // ---- Actions -------------------------------------------------------------

  async function onAction(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const holder = target.closest('[data-key]');
    const key = holder ? holder.dataset.key : null;
    const itemEl = target.closest('[data-id]');
    const id = itemEl ? itemEl.dataset.id : null;

    switch (action) {
      case 'open':
        if (itemEl.classList.contains('orphan')) toast("That highlight isn't on the page right now.");
        else await openHighlight(key, id);
        break;
      case 'open-page':
        e.preventDefault();
        if (!isCurrent(key)) await chrome.tabs.create({ url: findPage(key).url });
        break;
      case 'toggle':
        if (state.collapsed.has(key)) state.collapsed.delete(key);
        else state.collapsed.add(key);
        render();
        break;
      case 'pick': {
        const open = !itemEl.classList.contains('picking');
        closePickers();
        itemEl.classList.toggle('picking', open);
        break;
      }
      case 'color':
        closePickers();
        await HL.mutatePage(key, (list) => list.map((h) => (h.id === id ? { ...h, color: target.dataset.color } : h)));
        break;
      case 'note': {
        if (state.editing && state.editing.id === id && state.editing.key === key) break;
        if (state.editing) await saveNote(); // keep what was typed in another note
        const page = findPage(key);
        const h = page && page.highlights.find((x) => x.id === id);
        state.editing = { key, id, draft: HL.noteOf(h) };
        render();
        break;
      }
      case 'learn': {
        const page = findPage(key);
        const h = page && page.highlights.find((x) => x.id === id);
        if (!h) break;
        if (h.learn) {
          await updateHighlight(key, id, (x) => HL.withLearn(x, false));
          toast('Marked as understood', () => updateHighlight(key, id, (x) => HL.withLearn(x, true)));
          break;
        }
        await updateHighlight(key, id, (x) => HL.withLearn(x, true));
        if (!HL.noteOf(h)) {
          // Ask what to learn: open the note box with a prompt.
          if (state.editing) await saveNote();
          state.editing = { key, id, draft: '', placeholder: LEARN_PROMPT };
          render();
        }
        break;
      }
      case 'note-save':
        await saveNote();
        break;
      case 'note-cancel':
        cancelNote();
        break;
      case 'copy':
        await copy(findPage(key).highlights.find((h) => h.id === id).text);
        break;
      case 'delete':
        await deleteHighlights(key, [id]);
        break;
      case 'copy-page':
        await copy(HL.data.toMarkdown([visiblePage(key)]));
        break;
      case 'delete-page':
        await deleteHighlights(
          key,
          visiblePage(key).highlights.map((h) => h.id)
        );
        break;
      case 'more':
        state.timelineLimit += TIMELINE_PAGE;
        render();
        break;
    }
  }

  // On the current tab's page: scroll to it. Elsewhere: open the page in a new
  // tab and keep asking it to scroll until the highlight has been restored.
  async function openHighlight(key, id) {
    if (isCurrent(key)) {
      const res = await send(current.tabId, { type: HL.MSG.SCROLL_TO, id });
      if (!res || !res.ok) toast("That highlight isn't on the page right now.");
      return;
    }
    const page = findPage(key);
    if (!page) return;
    const tab = await chrome.tabs.create({ url: page.url });
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res = await send(tab.id, { type: HL.MSG.SCROLL_TO, id });
      if (res && res.ok) return;
    }
  }

  async function saveNote() {
    const edit = state.editing;
    if (!edit) return;
    state.editing = null;
    await updateHighlight(edit.key, edit.id, (h) => HL.withNote(h, edit.draft));
  }

  // Saves a change to one highlight, then shows it right away rather than after the
  // storage-change reload.
  async function updateHighlight(key, id, update) {
    const change = (h) => (h.id === id ? update(h) : h);
    await HL.mutatePage(key, (list) => list.map(change));
    const stored = pages.find((p) => p.key === key);
    if (stored) stored.highlights = stored.highlights.map(change);
    if (isCurrent(key)) current.highlights = current.highlights.map(change);
    render();
  }

  function cancelNote() {
    if (!state.editing) return;
    state.editing = null;
    render();
  }

  async function deleteHighlights(key, ids) {
    const page = findPage(key);
    const drop = new Set(ids);
    let removed = [];
    await HL.mutatePage(key, (list) => {
      removed = list.filter((h) => drop.has(h.id));
      return list.filter((h) => !drop.has(h.id));
    });
    if (!removed.length) return;
    const meta = page ? { url: page.url, title: page.title } : undefined;
    toast(`Deleted ${removed.length} highlight${plural(removed.length)}`, () =>
      HL.mutatePage(key, (list) => HL.data.mergeHighlights(list, removed).list, meta)
    );
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast("Couldn't copy to the clipboard.");
    }
  }

  function closePickers() {
    document.querySelectorAll('.item.picking').forEach((li) => li.classList.remove('picking'));
  }

  // ---- Export / import -----------------------------------------------------

  function exportMarkdown() {
    const source = state.view === 'page' ? (isCurrentAvailable() ? [currentPage()] : []) : pages;
    const shown = HL.data.filterAndSort(source, filters()).pages;
    if (!shown.length) return toast('Nothing to export.');
    const filtered = state.view === 'learn' ? ' (to learn)' : state.query.trim() || state.colors.size ? ' (filtered)' : '';
    const header = `# Highlights\n\nExported ${new Date().toLocaleString()}${filtered}\n\n`;
    download(`highlights-${today()}.md`, header + HL.data.toMarkdown(shown), 'text/markdown');
  }

  function exportBackup() {
    if (!pages.length) return toast('Nothing to export.');
    download(`highlight-backup-${today()}.json`, JSON.stringify(HL.data.toBackup(pages), null, 2), 'application/json');
  }

  async function importBackup(file) {
    let incoming;
    try {
      incoming = HL.data.parseBackup(await file.text());
    } catch (err) {
      return toast(err.message);
    }
    let added = 0;
    let skipped = 0;
    const touched = new Set();
    const bookmarkPages = new Set(); // pages where an older bookmark was dropped
    for (const page of incoming) {
      const known = pages.some((p) => p.key === page.key);
      await HL.mutatePage(
        page.key,
        (list) => {
          const result = HL.data.mergeHighlights(list, page.highlights);
          added += result.added;
          skipped += result.skipped;
          if (result.added) touched.add(page.key);
          if (result.droppedBookmarks) bookmarkPages.add(page.key);
          return result.list;
        },
        known ? undefined : { url: page.url, title: page.title }
      );
    }
    const n = bookmarkPages.size;
    toast(
      `Added ${added} highlight${plural(added)} on ${touched.size} page${plural(touched.size)}` +
        (skipped ? `, skipped ${skipped} already present.` : '.') +
        (n ? ` Kept only the newest bookmark on ${n} page${plural(n)}.` : '')
    );
  }

  function isCurrentAvailable() {
    return !!current && !current.unavailable;
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ---- Toast ---------------------------------------------------------------

  let toastTimer = null;
  let undoAction = null;

  function toast(message, undo) {
    $('toastText').textContent = message;
    undoAction = undo || null;
    $('toastUndo').hidden = !undo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 2500);
  }

  function hideToast() {
    $('toast').hidden = true;
    undoAction = null;
  }

  // ---- Events --------------------------------------------------------------

  function bindEvents() {
    $('content').addEventListener('click', onAction);
    $('content').addEventListener('keydown', (e) => {
      if (e.target.matches('.note-editor textarea')) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          saveNote();
        }
        return; // Escape is handled below, on document
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.item-main')) {
        e.preventDefault();
        onAction(e);
      }
    });

    document.querySelector('.views').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      state.view = b.dataset.view;
      state.timelineLimit = TIMELINE_PAGE;
      render();
    });

    let searchTimer = null;
    $('search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = e.target.value;
        state.timelineLimit = TIMELINE_PAGE;
        render();
      }, 120);
    });

    $('colors').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const on = !state.colors.has(b.dataset.color);
      if (on) state.colors.add(b.dataset.color);
      else state.colors.delete(b.dataset.color);
      b.setAttribute('aria-pressed', String(on));
      $('colors').classList.toggle('filtering', state.colors.size > 0);
      render();
    });

    $('sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      render();
    });

    $('openTab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') }));

    const setMenu = (open) => {
      $('menu').hidden = !open;
      $('menuButton').setAttribute('aria-expanded', String(open));
    };
    $('menuButton').addEventListener('click', () => setMenu($('menu').hidden));
    $('menu').addEventListener('click', (e) => {
      const b = e.target.closest('[data-command]');
      if (!b) return;
      setMenu(false);
      if (b.dataset.command === 'export-md') exportMarkdown();
      else if (b.dataset.command === 'export-json') exportBackup();
      else if (b.dataset.command === 'import') $('importFile').click();
    });
    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) importBackup(file);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu')) setMenu(false);
      if (!e.target.closest('.item.picking')) closePickers();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      setMenu(false);
      closePickers();
      cancelNote();
    });

    $('toastUndo').addEventListener('click', async () => {
      const undo = undoAction;
      hideToast();
      if (undo) await undo();
    });

    // Live updates: highlights added or edited anywhere, and (side panel) tab switches.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (Object.keys(changes).some((k) => k.startsWith(HL.PAGE_KEY_PREFIX) || k === HL.SETTINGS_KEY)) scheduleReload();
    });
    if (!inTab) {
      chrome.tabs.onActivated.addListener(scheduleReload);
      chrome.tabs.onUpdated.addListener((_tabId, info) => {
        if (info.status === 'complete') scheduleReload();
      });
      window.addEventListener('focus', scheduleReload);
    }
  }

  // Start last, once every const above is initialized.
  bindEvents();
  await reload();
})();
