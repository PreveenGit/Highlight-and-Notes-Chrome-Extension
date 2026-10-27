// Service worker: handles the keyboard commands.
importScripts('shared/common.js');

const OPEN_SIDE_PANEL = 'open-side-panel'; // command name in manifest.json

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === OPEN_SIDE_PANEL) {
    // Must be called right away: opening the panel needs the command's user gesture.
    if (tab) chrome.sidePanel.open({ windowId: tab.windowId });
  } else if (command === HL.MSG.HIGHLIGHT_SELECTION) {
    highlightSelection(tab);
  }
});

// Forwards the shortcut to the page's content script.
async function highlightSelection(tab) {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: HL.MSG.HIGHLIGHT_SELECTION });
  } catch {
    // No content script here: chrome:// pages, the Web Store, or a tab that was
    // open before the extension was installed (reload it).
  }
}
