// Library: every highlight on every page. The same page runs in Chrome's side
// panel and as a full tab. It reads storage directly; edits go through
// HL.mutatePage and reach open tabs through their storage.onChanged sync.
(async () => {
  const HL = globalThis.HL;
  const $ = (id) => document.getElementById(id);
  const TIMELINE_PAGE = 200;
  // The text box for each field: placeholder and label.
  const EDITORS = {
    note: { placeholder: 'Add a note…', label: 'Note' },
    question: { placeholder: 'What do you want to find out?', label: 'Your question' },
    answer: { placeholder: 'What did you learn?', label: 'What I learned' }
  };

  const ICONS = {
    chevron: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
    learn: 'M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    note: 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
    palette:
      'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
    arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    highlighter:
      'M22 24H2v-4h20v4zM13.06 5.19l3.75 3.75L7.75 18H4v-3.75l9.06-9.06zm4.82 2.68-3.75-3.75 1.83-1.83a.996.996 0 0 1 1.41 0l2.34 2.34c.39.39.39 1.02 0 1.41l-1.83 1.83z'
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
    editing: null, // text being edited: { key, id, field: 'note'|'question'|'answer', draft }; survives re-renders
    learnView: 'open' // To learn tab: 'open' (to learn) or 'done' (learned)
  };
  // library.html#learn / #learned opens the To learn tab (the popup links there).
  if (location.hash === '#learn' || location.hash === '#learned') {
    state.view = 'learn';
    state.learnView = location.hash === '#learned' ? 'done' : 'open';
  }
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
    return { query: state.query, colors: [...state.colors], sort: state.sort, learn: state.view === 'learn' ? state.learnView : false };
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
    const learnTab = document.querySelector('.views [data-view="learn"]');
    learnTab.replaceChildren('To learn');
    if (toLearn) {
      const count = el('span', 'view-count');
      count.textContent = String(toLearn);
      learnTab.append(count);
    }
    learnTab.setAttribute('aria-label', toLearn ? `To learn, ${toLearn}` : 'To learn');
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
    const out = [pageHero(page, shown ? shown.highlights.length : 0)];
    const bookmark = page.highlights.find((h) => h.bookmark);
    if (bookmark) out.push(jumpCard(bookmark, page));
    if (!shown) return [...out, empty('No highlights match your search.')];

    // The page's highlights in reading order, on a rail like the timeline.
    const head = el('div', 'list-bar');
    const label = el('span', 'muted');
    label.textContent = 'In reading order';
    head.append(label);
    const list = el('ol', 'rail');
    for (const h of shown.highlights) {
      const entry = item(h, page, false);
      entry.classList.add('rail-item');
      entry.style.setProperty('--dot', h.bookmark ? 'var(--accent)' : HL.colorValue(h.color));
      list.append(entry);
    }
    return [...out, head, list];
  }

  // The current page at a glance: its title and site, counts, and page actions.
  function pageHero(page, shownCount) {
    const all = page.highlights;
    const hero = el('section', 'page-hero');
    hero.dataset.key = page.key;

    const top = el('div', 'hero-top');
    const tile = el('span', 'site-tile big');
    tile.append(favicon(page));
    const title = el('div', 'hero-title');
    const name = el('p');
    name.textContent = page.title;
    name.title = page.url;
    const site = el('span', 'muted');
    site.textContent = page.site;
    title.append(name, site);
    top.append(tile, title);

    const stats = el('div', 'hero-stats');
    const stat = (n, label, cls = '') => {
      const box = el('div', `stat ${cls}`.trim());
      const value = el('strong');
      value.textContent = String(n);
      const text = el('span');
      text.textContent = label;
      box.append(value, text);
      return box;
    };
    const notes = all.filter((h) => HL.noteOf(h)).length;
    const toLearn = all.filter((h) => h.learn).length;
    stats.append(
      stat(all.length, all.length === 1 ? 'Highlight' : 'Highlights'),
      stat(notes, notes === 1 ? 'Note' : 'Notes'),
      stat(toLearn, 'To learn', toLearn ? 'learn' : '')
    );

    const actions = el('div', 'hero-actions');
    const filtered = shownCount < all.length;
    const copy = pillButton('copy', filtered ? `Copy ${shownCount} shown` : 'Copy as Markdown', 'copy-page');
    const del = pillButton('delete', filtered ? `Delete ${shownCount} shown` : 'Delete all', 'delete-page');
    del.classList.add('danger');
    copy.disabled = del.disabled = !shownCount;
    actions.append(copy, del);

    hero.append(top, stats, actions);
    return hero;
  }

  // "Continue reading": the page's bookmark, like the toolbar popup's card.
  function jumpCard(bookmark, page) {
    const card = el('button', 'jump-card');
    card.type = 'button';
    card.dataset.action = 'open';
    card.dataset.key = page.key;
    card.dataset.id = bookmark.id;
    card.classList.toggle('orphan', bookmark.found === false);
    card.title = bookmark.found === false ? "The bookmarked line isn't on the page right now" : 'Scroll to your bookmark';
    card.innerHTML =
      `<span class="jump-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.bookmark}"/></svg></span>` +
      '<span class="jump-body"><span class="jump-title">Continue reading</span><span class="jump-text"></span><span class="jump-when"></span></span>' +
      `<svg class="jump-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.arrow}"/></svg>`;
    card.querySelector('.jump-text').textContent = `“${bookmark.text}”`;
    card.querySelector('.jump-when').textContent =
      bookmark.found === false ? 'Not on the page right now' : `Saved ${ago(bookmark.createdAt)}`;
    return card;
  }

  function renderPages() {
    if (!pages.length) return [empty('No highlights yet. Select text on any page and pick a color.')];
    const shown = HL.data.filterAndSort(pages, filters()).pages;
    if (!shown.length) return [empty('No highlights match your search.')];
    return [pagesBar(shown), ...shown.map((page) => pageCard(page))];
  }

  // Above the page cards: how many are shown, and Collapse all / Expand all.
  function pagesBar(shown) {
    const bar = el('div', 'list-bar');
    const label = el('span', 'muted');
    const count = shown.reduce((sum, p) => sum + p.highlights.length, 0);
    label.textContent = `${shown.length} page${plural(shown.length)} · ${count} highlight${plural(count)}`;
    const allCollapsed = shown.every((p) => state.collapsed.has(p.key));
    const button = el('button', 'link-btn');
    button.type = 'button';
    button.dataset.action = allCollapsed ? 'expand-all' : 'collapse-all';
    button.dataset.keys = shown.map((p) => p.key).join('\n');
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.chevron}"/></svg>`;
    button.classList.toggle('up', !allCollapsed);
    const text = el('span');
    text.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
    button.append(text);
    bar.append(label, button);
    return bar;
  }

  function renderTimeline() {
    if (!pages.length) return [empty('No highlights yet. Select text on any page and pick a color.')];
    const { timeline } = HL.data.filterAndSort(pages, filters());
    if (!timeline.length) return [empty('No highlights match your search.')];
    return timelineList(timeline);
  }

  // Learn more on every page: a header with progress and a To learn / Learned
  // switch, then one study card per passage with its question first.
  function renderLearn() {
    const open = learnCount();
    const done = learnedCount();
    if (!open && !done) {
      return [
        empty(
          'Nothing marked to learn yet. Click Learn more on a highlight here, or select text on a page and click the graduation-cap button in the toolbar.',
          'learn'
        )
      ];
    }
    const learned = state.learnView === 'done';
    const { timeline } = HL.data.filterAndSort(pages, filters());
    const head = learnHeader(open, done, timeline.length);
    if (!timeline.length) {
      const message = (learned ? done : open)
        ? learned ? 'Nothing learned matches your search.' : 'Nothing to learn matches your search.'
        : learned
          ? 'Nothing learned yet. Click Got it on a passage once you understand it.'
          : 'All caught up: nothing left to learn.';
      return [head, empty(message, learned ? 'check' : 'learn')];
    }
    const list = el('ul', 'learn-list');
    list.append(...timeline.slice(0, state.timelineLimit).map(({ highlight, page }) => learnCard(highlight, page)));
    const out = [head, list];
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

  // "3 to learn · 5 learned", a progress bar, and the To learn / Learned switch.
  function learnHeader(open, done, shown) {
    const head = el('div', 'learn-head');
    const top = el('div', 'learn-head-top');
    const icon = el('span', 'learn-head-icon');
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.learn}"/></svg>`;
    const text = el('div', 'learn-head-text');
    const title = el('h2');
    title.textContent = open ? `${open} passage${plural(open)} to learn` : 'All caught up';
    const sub = el('p');
    const total = state.learnView === 'done' ? done : open;
    sub.textContent =
      shown < total
        ? `Showing ${shown} that match your filters.`
        : done
          ? `${done} learned so far${open ? ` · ${open} to go` : ''}.`
          : 'Click Got it on a passage once you understand it.';
    text.append(title, sub);
    top.append(icon, text);

    const progress = el('div', 'learn-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Learned');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(open + done));
    progress.setAttribute('aria-valuenow', String(done));
    const fill = el('span');
    fill.style.width = `${open + done ? Math.round((done / (open + done)) * 100) : 0}%`;
    progress.append(fill);

    const tabs = el('div', 'learn-switch');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Learn more');
    for (const [view, label, n] of [['open', 'To learn', open], ['done', 'Learned', done]]) {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.action = 'learn-view';
      b.dataset.view = view;
      b.setAttribute('aria-selected', String(state.learnView === view));
      const count = el('span', 'switch-count');
      count.textContent = String(n);
      b.append(label, count);
      tabs.append(b);
    }

    head.append(top, progress, tabs);
    return head;
  }

  // A passage on the Learn more track: the question first, the passage in its
  // highlight color, the note, then (learned) what was learned; where it's from,
  // and Got it or Learn again.
  function learnCard(h, page) {
    const learned = HL.learnStateOf(h) === 'learned';
    const card = el('li', 'learn-card');
    card.classList.toggle('learned', learned);
    card.dataset.key = page.key;
    card.dataset.id = h.id;
    const terms = HL.data.searchTerms(state.query);
    const editing = (field) => !!state.editing && state.editing.id === h.id && state.editing.key === page.key && state.editing.field === field;

    const question = HL.questionOf(h);
    const row = el('div', 'learn-q');
    const mark = el('span', 'q-mark');
    mark.textContent = learned ? '✓' : '?';
    mark.setAttribute('aria-hidden', 'true');
    row.append(mark);
    if (editing('question')) {
      const label = el('span', 'q-label');
      label.textContent = 'Your question';
      row.append(label);
    } else {
      const text = el('button', question ? 'q-text' : 'q-text blank');
      text.type = 'button';
      text.dataset.action = 'question';
      text.title = question ? 'Edit question' : 'Add a question';
      if (question) appendWithHits(text, question, terms);
      else text.textContent = learned ? 'Add the question you had' : 'What do you want to find out? Add a question';
      row.append(text);
    }
    card.append(row);
    if (editing('question')) card.append(noteEditor());

    const passage = el('div', 'learn-passage');
    passage.dataset.action = 'open';
    passage.tabIndex = 0;
    passage.setAttribute('role', 'button');
    passage.title = isCurrent(page.key) ? 'Show on page' : 'Open the page and show';
    passage.style.setProperty('--hl', h.bookmark ? 'var(--accent)' : HL.colorValue(h.color));
    const text = el('p', 'text');
    appendWithHits(text, String(h.text || ''), terms);
    passage.append(text);
    card.append(passage);

    // The note, if any, stays a note.
    const note = HL.noteOf(h);
    if (editing('note')) card.append(noteEditor());
    else if (note) {
      const noteEl = el('button', 'user-note');
      noteEl.type = 'button';
      noteEl.dataset.action = 'note';
      noteEl.title = 'Edit note';
      appendWithHits(noteEl, note, terms);
      card.append(noteEl);
    }

    // Learned: what was learned.
    if (learned) {
      const answer = HL.answerOf(h);
      if (editing('answer')) card.append(noteEditor());
      else if (answer) {
        const box = el('button', 'learned-answer');
        box.type = 'button';
        box.dataset.action = 'answer';
        box.title = 'Edit what you learned';
        const label = el('span', 'answer-label');
        label.textContent = 'What I learned';
        const body = el('span');
        appendWithHits(body, answer, terms);
        box.append(label, body);
        card.append(box);
      }
    }

    const foot = el('div', 'learn-foot');
    const source = el('span', 'learn-src');
    const where = el('span');
    where.textContent = [page.title, learned ? `learned ${ago(h.learnedAt)}` : ago(h.createdAt)].filter(Boolean).join(' · ');
    where.title = page.url;
    source.append(favicon(page), where);
    const tools = el('div', 'learn-tools');
    const extra = el('div', 'item-actions');
    extra.append(
      iconButton('copy', 'Copy text', 'copy'),
      ...(learned ? [iconButton('close', 'Remove from Learned', 'unlearn')] : []),
      iconButton('delete', 'Delete highlight', 'delete')
    );
    tools.append(extra);
    if (learned) {
      if (!HL.answerOf(h) && !editing('answer')) tools.append(pillButton('note', 'Add what you learned', 'answer'));
      tools.append(pillButton('learn', 'Learn again', 'learn-again', 'Move back to To learn'));
    } else {
      const got = pillButton('check', 'Got it', 'learn', 'Got it: move to Learned');
      got.classList.add('got');
      tools.append(got);
    }
    foot.append(source, tools);
    card.append(foot);
    return card;
  }

  function learnCount() {
    return pages.reduce((n, p) => n + p.highlights.filter((h) => HL.learnStateOf(h) === 'learn').length, 0);
  }

  function learnedCount() {
    return pages.reduce((n, p) => n + p.highlights.filter((h) => HL.learnStateOf(h) === 'learned').length, 0);
  }

  // The timeline: highlights grouped by day ("Today", "Yesterday", ...) on a rail,
  // each with a dot in its color.
  function timelineList(timeline) {
    const out = [];
    let list = null;
    let day = null;
    for (const { highlight, page } of timeline.slice(0, state.timelineLimit)) {
      const label = dayLabel(highlight.createdAt);
      if (label !== day) {
        day = label;
        const section = el('section', 'day');
        const heading = el('h2', 'day-label');
        const name = el('span');
        name.textContent = label;
        const count = el('span', 'day-count');
        heading.append(name, count);
        list = el('ol', 'rail');
        section.append(heading, list);
        out.push(section);
      }
      const entry = item(highlight, page, true);
      entry.classList.add('rail-item');
      entry.style.setProperty('--dot', highlight.bookmark ? 'var(--accent)' : HL.colorValue(highlight.color));
      list.append(entry);
      const count = list.parentNode.querySelector('.day-count');
      count.textContent = String(list.children.length);
    }
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

  // A page with its highlights: the site icon in a tile, the title and site, the
  // colors used, a count, the page actions and (in All pages) a collapse toggle.
  // Clicking the header's empty space collapses it too; a collapsed card shows its
  // first highlight as a preview. In "This page" it can't collapse, and the
  // "Current tab" badge would only repeat the view's name.
  function pageCard(page, { collapsible = true } = {}) {
    const collapsed = collapsible && state.collapsed.has(page.key);
    const n = page.highlights.length;
    const card = el('section', 'card');
    card.dataset.key = page.key;
    card.classList.toggle('current', collapsible && isCurrent(page.key));
    card.classList.toggle('collapsed', collapsed);

    const head = el('div', 'card-head');
    head.classList.toggle('fixed', !collapsible);
    if (collapsible) {
      head.dataset.action = 'toggle';
      head.title = collapsed ? 'Expand' : 'Collapse';
    }

    const tile = el('span', 'site-tile');
    tile.append(favicon(page));

    const title = el('div', 'card-title');
    const link = el('a');
    link.href = page.url;
    link.title = isCurrent(page.key) ? page.url : `Open ${page.url}`;
    link.dataset.action = 'open-page';
    appendWithHits(link, page.title, HL.data.searchTerms(state.query));
    const meta = el('span', 'meta muted');
    if (collapsible && isCurrent(page.key)) {
      const badge = el('span', 'badge');
      badge.textContent = 'Current tab';
      meta.append(badge);
    }
    meta.append([page.site, ago(page.lastAt)].filter(Boolean).join(' · '));
    title.append(link, meta);

    const count = el('span', 'count-pill');
    count.textContent = String(n);
    count.title = `${n} highlight${plural(n)}`;

    const actions = el('div', 'card-actions');
    actions.append(
      iconButton('copy', 'Copy as Markdown', 'copy-page'),
      iconButton('delete', `Delete ${n} highlight${plural(n)}`, 'delete-page')
    );

    head.append(tile, title, colorDots(page.highlights), count, actions);
    if (collapsible) {
      const toggle = iconButton('chevron', collapsed ? 'Expand' : 'Collapse', 'toggle');
      toggle.classList.add('toggle');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      head.append(toggle);
    }
    card.append(head);

    if (collapsed) {
      const preview = el('p', 'card-preview');
      preview.dataset.action = 'toggle';
      const first = el('span');
      first.textContent = `“${page.highlights[0].text}”`;
      preview.append(first);
      if (n > 1) {
        const more = el('span', 'more-count');
        more.textContent = `+${n - 1} more`;
        preview.append(more);
      }
      card.append(preview);
    } else {
      card.append(itemList(page.highlights, page, false));
    }
    return card;
  }

  // The colors a page's highlights use, most used first (at most five).
  function colorDots(highlights) {
    const counts = new Map();
    for (const h of highlights) {
      if (h.bookmark) continue;
      counts.set(h.color, (counts.get(h.color) || 0) + 1);
    }
    const box = el('span', 'color-dots');
    box.setAttribute('aria-hidden', 'true');
    for (const [color] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      const dot = el('span');
      dot.style.background = HL.colorValue(color);
      box.append(dot);
    }
    return box;
  }

  function itemList(highlights, page, showPage) {
    const list = el('ul', 'items');
    list.append(...highlights.map((h) => item(h, page, showPage)));
    return list;
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
    const learnState = HL.learnStateOf(h);
    const question = learnState === 'none' ? '' : HL.questionOf(h);
    const editingField = !!state.editing && state.editing.id === h.id && state.editing.key === page.key ? state.editing.field : null;
    const editing = !!editingField;

    const main = el('div', 'item-main');
    main.dataset.action = 'open';
    main.tabIndex = 0;
    main.setAttribute('role', 'button');
    main.title = orphan ? '' : isCurrent(page.key) ? 'Show on page' : 'Open the page and show';
    const text = el('p', 'text');
    appendWithHits(text, String(h.text || ''), terms);
    main.append(text);

    // The note and the Learn more question are their own buttons: clicking one edits it.
    let noteEl = null;
    if (note && editingField !== 'note') {
      noteEl = el('button', 'user-note');
      noteEl.type = 'button';
      noteEl.dataset.action = 'note';
      noteEl.title = 'Edit note';
      appendWithHits(noteEl, note, terms);
    }
    let questionEl = null;
    if (question && editingField !== 'question') {
      questionEl = el('button', 'item-question');
      questionEl.type = 'button';
      questionEl.dataset.action = 'question';
      questionEl.title = 'Edit question';
      const mark = el('span', 'q-mark small');
      mark.textContent = '?';
      mark.setAttribute('aria-hidden', 'true');
      const body = el('span');
      appendWithHits(body, question, terms);
      questionEl.append(mark, body);
    }

    const meta = el('span', 'meta');
    if (h.bookmark) {
      const tag = el('span', 'bookmark-tag');
      tag.textContent = 'Bookmark';
      meta.append(tag);
    }
    if (learnState !== 'none') {
      const tag = el('span', learnState === 'learn' ? 'learn-tag' : 'learned-tag');
      tag.textContent = learnState === 'learn' ? 'Learn more' : 'Learned';
      meta.append(tag);
    }
    // On the timeline (showPage) the day is the heading, so the time of day is
    // enough, and the page gets its icon.
    if (showPage) meta.append(favicon(page));
    meta.append(
      [
        showPage ? page.title : '',
        showPage ? page.site : '',
        orphan ? 'Not found on the page right now' : showPage ? timeOfDay(h.createdAt) : ago(h.createdAt)
      ]
        .filter(Boolean)
        .join(' · ')
    );
    // The note, the editor and the quick actions sit outside .item-main, which is
    // itself a button.
    const body = el('div', 'item-body');
    body.append(main);
    if (noteEl) body.append(noteEl);
    if (questionEl) body.append(questionEl);
    // The meta line and the tools share a row when there's room. The tools are the
    // quick actions (always visible, so notes and Learn more are easy to find) and
    // the color/copy/delete icons, which show on hover but keep their place so
    // nothing ever covers the quick actions.
    const foot = el('div', 'item-foot');
    const tools = el('div', 'tools');
    if (!editing) {
      if (!note) tools.append(pillButton('note', 'Add note', 'note'));
      // Learned passages are managed in the To learn tab (Learned), so no button here.
      if (learnState !== 'learned') {
        tools.append(
          learnState === 'learn'
            ? pillButton('check', 'Got it', 'learn', 'Got it: move to Learned')
            : pillButton('learn', 'Learn more', 'learn', 'Mark to learn more and write what you want to find out')
        );
        tools.lastChild.classList.add('learn', ...(learnState === 'learn' ? ['on'] : []));
      }
    }
    const actions = el('div', 'item-actions');
    actions.append(
      ...(h.bookmark ? [] : [iconButton('palette', 'Change color', 'pick')]), // bookmarks have no color
      iconButton('copy', 'Copy text', 'copy'),
      iconButton('delete', h.bookmark ? 'Delete bookmark' : 'Delete highlight', 'delete')
    );
    tools.append(actions);
    foot.append(meta, tools);
    body.append(foot);
    if (editing) body.append(noteEditor());

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
    swatches.append(addColorButton('Add your own color', 'add-color-item'));
    actions.append(swatches); // opens under the color button

    li.append(bar, body);
    return li;
  }

  // The text box for the note, the Learn more question or what was learned
  // (state.editing.field), with a small label.
  function noteEditor() {
    const kind = EDITORS[state.editing.field] || EDITORS.note;
    const box = el('div', `note-editor ${state.editing.field || 'note'}`);
    box.dataset.action = 'noop'; // clicks inside must not open the highlight
    const label = el('span', 'editor-label');
    label.textContent = kind.label;
    box.append(label);
    const area = el('textarea');
    area.value = state.editing.draft;
    area.rows = 3;
    area.placeholder = kind.placeholder;
    area.setAttribute('aria-label', kind.label);
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

  // A small labeled button with an icon, for the quick actions under a highlight.
  function pillButton(icon, label, action, title = label) {
    const b = el('button', 'pill');
    b.type = 'button';
    b.title = title;
    b.dataset.action = action;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
    const span = el('span');
    span.textContent = label;
    b.append(span);
    return b;
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
      }),
      addColorButton('Add your own color', 'add-color')
    );
    $('colors').classList.toggle('filtering', state.colors.size > 0);
  }

  function addColorButton(label, action) {
    const b = el('button', 'add');
    b.type = 'button';
    b.dataset.action = action;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.plus}"/></svg>`;
    return b;
  }

  // ---- Your own colors -----------------------------------------------------

  // A small panel to add a custom color (suggestions, the color picker or a typed
  // code) and, from the filter row, to remove ones you added. `onAdd(hex)` runs
  // after the color is saved to the palette.
  let colorPanel = null;
  function openColorPanel(anchor, { manage = false, onAdd = null } = {}, rect = anchor.getBoundingClientRect()) {
    closeColorPanel();
    const custom = HL.customColors(settings);
    const taken = HL.palette(settings).map(HL.colorValue);
    const panel = el('div', 'color-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Add your own color');

    const title = el('p', 'cp-title');
    title.textContent = 'Add your own color';
    panel.append(title);

    if (manage && custom.length) {
      const mine = el('div', 'cp-mine');
      const label = el('span', 'cp-label');
      label.textContent = 'Your colors';
      const row = el('div', 'cp-row');
      for (const color of custom) {
        const chip = el('span', 'cp-chip');
        chip.style.background = color;
        chip.title = color.toUpperCase();
        const remove = el('button', 'cp-remove');
        remove.type = 'button';
        remove.dataset.remove = color;
        remove.title = `Remove ${color.toUpperCase()}`;
        remove.setAttribute('aria-label', `Remove ${color.toUpperCase()}`);
        remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.close}"/></svg>`;
        chip.append(remove);
        row.append(chip);
      }
      mine.append(label, row);
      panel.append(mine);
    }

    if (custom.length >= HL.MAX_CUSTOM_COLORS) {
      const full = el('p', 'cp-note');
      full.textContent = `You have ${HL.MAX_CUSTOM_COLORS} colors of your own. Remove one to add another.`;
      panel.append(full);
    } else {
      const choices = HL.SUGGESTED_COLORS.filter((c) => !taken.includes(c));
      const suggestions = el('div', 'cp-row cp-suggestions');
      for (const color of choices) {
        const b = el('button');
        b.type = 'button';
        b.dataset.suggest = color;
        b.title = color.toUpperCase();
        b.setAttribute('aria-label', `Use ${color.toUpperCase()}`);
        b.style.background = color;
        suggestions.append(b);
      }
      const form = el('form', 'cp-form');
      form.noValidate = true;
      form.innerHTML =
        '<input type="color" aria-label="Pick a color" />' +
        '<input type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Color code" />' +
        '<button type="submit" class="text-btn primary">Add</button>';
      const error = el('p', 'cp-error');
      error.setAttribute('role', 'alert');
      error.hidden = true;
      if (choices.length) panel.append(suggestions);
      panel.append(form, error);

      const [picker, code] = form.querySelectorAll('input');
      const setDraft = (color, typed = false) => {
        const hex = HL.parseHex(color);
        if (hex) picker.value = hex;
        if (!typed) code.value = (hex || color).toUpperCase();
        for (const b of suggestions.children) b.setAttribute('aria-pressed', String(b.dataset.suggest === hex));
        error.hidden = true;
        code.removeAttribute('aria-invalid');
      };
      const fail = (message) => {
        error.textContent = message;
        error.hidden = false;
        code.setAttribute('aria-invalid', 'true');
        code.focus();
      };
      suggestions.addEventListener('click', (e) => {
        const b = e.target.closest('[data-suggest]');
        if (b) setDraft(b.dataset.suggest);
      });
      picker.addEventListener('input', () => setDraft(picker.value));
      code.addEventListener('input', () => setDraft(code.value, true));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const hex = HL.parseHex(code.value);
        if (!hex) return fail('Enter a color code like #C4B5FD.');
        if (HL.palette(settings).map(HL.colorValue).includes(hex)) return fail("That color's already in your colors.");
        await saveCustomColors([...HL.customColors(settings), hex]);
        closeColorPanel();
        if (onAdd) await onAdd(hex);
      });
      setDraft(choices[0] || '#c4b5fd');
    }

    panel.addEventListener('click', async (e) => {
      const remove = e.target.closest('[data-remove]');
      if (!remove) return;
      await saveCustomColors(HL.customColors(settings).filter((c) => c !== remove.dataset.remove));
      // Show the updated list in the same place; the filter row's "+" was redrawn.
      const fresh = manage ? $('colors').querySelector('.add') : anchor;
      openColorPanel(fresh && fresh.isConnected ? fresh : anchor, { manage, onAdd }, rect);
    });
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeColorPanel();
      if (anchor.isConnected) anchor.focus();
    });

    document.body.append(panel);
    placePanel(panel, rect);
    anchor.setAttribute('aria-expanded', 'true');
    colorPanel = { panel, anchor };
    const code = panel.querySelector('input[type=text]');
    if (code) {
      code.focus();
      code.select();
    }
  }

  // Under the button that opened it (above when there's no room), inside the window.
  function placePanel(panel, rect) {
    const { width, height } = panel.getBoundingClientRect();
    let top = rect.bottom + 8;
    if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    const left = Math.min(Math.max(8, rect.right - width), innerWidth - width - 8);
    panel.style.top = `${top}px`;
    panel.style.left = `${Math.max(8, left)}px`;
  }

  function closeColorPanel() {
    if (!colorPanel) return;
    colorPanel.panel.remove();
    colorPanel.anchor.setAttribute('aria-expanded', 'false');
    colorPanel = null;
  }

  // Saves the custom colors. A removed default color falls back to yellow;
  // highlights in a removed color keep it.
  async function saveCustomColors(list) {
    const patch = { customColors: list };
    if (!HL.isColor(settings.defaultColor) || (HL.parseHex(settings.defaultColor) && !list.includes(settings.defaultColor))) {
      patch.defaultColor = HL.DEFAULT_SETTINGS.defaultColor;
    }
    settings = HL.cleanSettings(await HL.setSettings(patch));
    buildColorChips();
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

  function empty(message, icon = 'highlighter') {
    const box = el('div', 'empty');
    box.classList.toggle('learn', icon === 'learn');
    const tile = el('span', 'empty-icon');
    tile.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[icon]}"/></svg>`;
    const p = el('p');
    p.textContent = message;
    box.append(tile, p);
    return box;
  }

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function ago(time) {
    return HL.ago(time);
  }

  // "Today", "Yesterday", a weekday within the last week, then a date.
  const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
  const DATE = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });
  const DATE_YEAR = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  function dayLabel(time) {
    if (!time) return 'Earlier';
    const date = new Date(time);
    const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(date)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return WEEKDAY.format(date);
    return date.getFullYear() === new Date().getFullYear() ? DATE.format(date) : DATE_YEAR.format(date);
  }

  function timeOfDay(time) {
    return time ? TIME.format(time) : '';
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
      case 'collapse-all':
      case 'expand-all':
        for (const k of target.dataset.keys.split('\n')) {
          if (action === 'collapse-all') state.collapsed.add(k);
          else state.collapsed.delete(k);
        }
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
      case 'add-color-item':
        // Add a color of your own and use it for this highlight.
        if (colorPanel && colorPanel.anchor === target) {
          closeColorPanel();
          break;
        }
        openColorPanel(target, {
          onAdd: async (hex) => {
            closePickers();
            await HL.mutatePage(key, (list) => list.map((h) => (h.id === id ? { ...h, color: hex } : h)));
          }
        });
        break;
      case 'note':
      case 'question':
      case 'answer':
        await editField(key, id, action);
        break;
      case 'learn': {
        // Learn more (then ask the question), or Got it (move to Learned).
        const h = findHighlight(key, id);
        if (!h) break;
        if (HL.learnStateOf(h) === 'learn') {
          await updateHighlight(key, id, (x) => HL.withLearnState(x, 'learned'));
          toast('Moved to Learned', () => updateHighlight(key, id, (x) => HL.withLearnState(x, 'learn')));
          break;
        }
        await updateHighlight(key, id, (x) => HL.withLearnState(x, 'learn'));
        await editField(key, id, 'question');
        break;
      }
      case 'learn-again': {
        const before = findHighlight(key, id);
        const learnedAt = before && before.learnedAt;
        await updateHighlight(key, id, (x) => HL.withLearnState(x, 'learn'));
        toast('Moved back to To learn', () => updateHighlight(key, id, (x) => HL.withLearnState({ ...x, learnedAt }, 'learned')));
        break;
      }
      case 'unlearn': {
        const before = findHighlight(key, id);
        await updateHighlight(key, id, (x) => HL.withLearnState(x, 'none'));
        if (before) {
          const keep = { question: before.question, answer: before.answer, learnedAt: before.learnedAt };
          toast('Removed from Learned', () => updateHighlight(key, id, (x) => ({ ...x, ...keep })));
        }
        break;
      }
      case 'learn-view':
        state.learnView = target.dataset.view;
        state.timelineLimit = TIMELINE_PAGE;
        render();
        break;
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

  function findHighlight(key, id) {
    const page = findPage(key);
    return page && page.highlights.find((h) => h.id === id);
  }

  // Opens the text box for a highlight's note, Learn more question or what was
  // learned, saving any other open box first.
  async function editField(key, id, field) {
    const edit = state.editing;
    if (edit && edit.id === id && edit.key === key && edit.field === field) return;
    if (edit) await saveNote(); // keep what was typed in another box
    const h = findHighlight(key, id);
    const read = { note: HL.noteOf, question: HL.questionOf, answer: HL.answerOf }[field];
    state.editing = { key, id, field, draft: read(h) };
    render();
  }

  // Saves the open text box to its field.
  async function saveNote() {
    const edit = state.editing;
    if (!edit) return;
    state.editing = null;
    const write = { note: HL.withNote, question: HL.withQuestion, answer: HL.withAnswer }[edit.field] || HL.withNote;
    await updateHighlight(edit.key, edit.id, (h) => write(h, edit.draft));
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
    const filtered =
      state.view === 'learn'
        ? state.learnView === 'done' ? ' (learned)' : ' (to learn)'
        : state.query.trim() || state.colors.size ? ' (filtered)' : '';
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
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.item-main, .learn-passage')) {
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
      if (b.dataset.action === 'add-color') {
        if (colorPanel && colorPanel.anchor === b) closeColorPanel();
        else openColorPanel(b, { manage: true, onAdd: (hex) => toast(`Added ${hex.toUpperCase()} to your colors`) });
        return;
      }
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
      if (colorPanel && !e.target.closest('.color-panel, [data-action^="add-color"]')) closeColorPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      setMenu(false);
      closePickers();
      closeColorPanel();
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
