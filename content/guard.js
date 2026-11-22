// Keeps typing in the note editor away from the page. Runs at document_start, before
// any page script, so these window listeners fire before the page's own.
//
// Some sites (chatgpt.com, for one) watch every keystroke and move it into their own
// input box when you are not typing in a text field. Keys typed into our note box
// leave the toolbar's closed shadow root looking like they come from <hl-toolbar>,
// not a text field, so those sites would grab them. Stopping the events here hides
// them from the page; the browser still types into the note box, and the toolbar
// handles its own shortcuts (Escape, Ctrl/Cmd+Enter) through handleKey.
(() => {
  const TYPES = [
    'keydown', 'keyup', 'keypress',
    'beforeinput', 'input',
    'compositionstart', 'compositionupdate', 'compositionend',
    'paste', 'copy', 'cut'
  ];

  function guard(event) {
    const toolbar = globalThis.HL && globalThis.HL.toolbar; // defined later, at document_idle
    if (!toolbar || !toolbar.isOpen() || !toolbar.owns(event)) return;
    event.stopImmediatePropagation();
    if (event.type === 'keydown') toolbar.handleKey(event);
  }

  for (const type of TYPES) window.addEventListener(type, guard, true);
})();
