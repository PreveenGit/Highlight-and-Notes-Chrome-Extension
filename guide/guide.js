// The Highlight guide: live counts, the practice area (the real highlighter in demo
// mode, which saves nothing), shortcuts, what's new, and scroll effects.
// Loaded before the content scripts, so demo mode is on before they start.
(() => {
  const HL = globalThis.HL;
  const $ = (id) => document.getElementById(id);
  HL.demo = true; // content/store.js keeps changes in memory only
  HL.demoRoot = () => $('demo'); // content/main.js only highlights in the practice article

  const CHANGES = [
    { version: '1.9', title: 'A guide to Highlight', items: ['This page, with a practice area to try everything.', 'Open it from the "?" in the toolbar popup, or the library menu.'] },
    { version: '1.8', title: 'Learn more, tracked', items: ['Learn more has its own question, separate from notes.', 'Got it moves a passage to your Learned list, with what you learned.', 'A new popup and a modern note box.'] },
    { version: '1.7', title: 'Your colors everywhere', items: ['Add your own colors from the library too.', 'A clearer "This page" view in the side panel.'] },
    { version: '1.6', title: 'A fresh look', items: ['A new icon.', 'Modern All pages, Timeline and To learn views.'] }
  ];

  const COMMANDS = {
    _execute_action: 'Open the Highlight popup',
    'highlight-selection': 'Highlight the selected text',
    'open-side-panel': 'Open the library in the side panel'
  };

  const openLibrary = () => chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
  $('openLibrary').addEventListener('click', openLibrary);
  $('openLibraryHero').addEventListener('click', openLibrary);
  $('changeShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  $('resetDemo').addEventListener('click', () => {
    HL.toolbar && HL.toolbar.hide();
    HL.marker && HL.marker.unwrapAll();
    HL.store && HL.store.clear();
  });

  const version = chrome.runtime.getManifest().version;
  $('version').textContent = version;
  if (location.hash === '#welcome') $('welcome').hidden = false;
  // Seen: the popup's "New" dot goes away until the next feature update.
  HL.setSettings({ guideSeen: version.split('.').slice(0, 2).join('.') }).catch(() => {});

  // ---- Your reading -----------------------------------------------------------
  async function renderStats() {
    const pages = HL.data.toPages(await chrome.storage.local.get(null));
    const all = pages.flatMap((p) => p.highlights);
    $('stats').hidden = !all.length;
    $('start').hidden = !!all.length;
    $('statHighlights').textContent = all.length;
    $('statPages').textContent = pages.length;
    $('statNotes').textContent = all.filter((h) => HL.noteOf(h)).length;
    $('statLearn').textContent = all.filter((h) => HL.learnStateOf(h) === 'learn').length;
    $('statLearned').textContent = all.filter((h) => HL.learnStateOf(h) === 'learned').length;
  }
  renderStats();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(HL.PAGE_KEY_PREFIX))) renderStats();
  });

  // ---- Shortcuts ----------------------------------------------------------------
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const keys = (combo) => {
    const box = el('span', 'keys');
    if (!combo) box.append(el('span', 'not-set', 'Not set'));
    else combo.split('+').forEach((k) => box.append(el('kbd', '', k.trim())));
    return box;
  };
  const row = (label, combo) => {
    const li = el('li');
    li.append(el('span', '', label), keys(combo));
    return li;
  };
  (async () => {
    const commands = await chrome.commands.getAll();
    const rows = commands.filter((c) => COMMANDS[c.name]).map((c) => row(COMMANDS[c.name], c.shortcut));
    const mac = /Mac|iP(hone|ad)/.test(navigator.platform);
    rows.push(row('Save a note or question', mac ? '⌘+Return' : 'Ctrl+Enter'), row('Close the note box or a menu', 'Esc'));
    $('shortcutList').replaceChildren(...rows);
  })();

  // ---- What's new ---------------------------------------------------------------
  $('changes').replaceChildren(
    ...CHANGES.map((c) => {
      const li = el('li');
      const list = el('ul');
      list.append(...c.items.map((t) => el('li', '', t)));
      li.append(el('span', 'version', c.version), el('h3', '', c.title), list);
      return li;
    })
  );

  // ---- Scroll effects: fade sections in, mark the current section in the nav --------
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('shown');
          reveal.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll('.reveal').forEach((n) => reveal.observe(n));

  const links = [...document.querySelectorAll('.nav a')];
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
      }
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  links.forEach((a) => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) spy.observe(target);
  });
})();
