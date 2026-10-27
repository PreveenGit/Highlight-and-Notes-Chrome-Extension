// Service worker: forwards the keyboard shortcut to the page's content script.
importScripts('shared/common.js');

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== HL.MSG.HIGHLIGHT_SELECTION) return;
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: HL.MSG.HIGHLIGHT_SELECTION });
  } catch {
    // No content script here: chrome:// pages, the Web Store, or a tab that was
    // open before the extension was installed (reload it).
  }
});
