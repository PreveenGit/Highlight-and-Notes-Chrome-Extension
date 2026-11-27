# Chrome Web Store submission

Copy-ready text for the [Developer Dashboard](https://chrome.google.com/webstore/devconsole). Fields are listed in the order the dashboard shows them.

## Before you submit

- [ ] Pick the final name. `manifest.json` says **Highlight**, which is generic and likely shared with other extensions. Options: *Highlight & Library*, *Margin — web highlighter*, *Keepmark*. If you change it, update `name` in `manifest.json`.
- [x] Contact email set in `docs/privacy-policy.html`; the page is published with GitHub Pages (see "Privacy policy URL" below).
- [ ] Bump `version` in `manifest.json` if this isn't the first upload, then run `.\store\package.ps1` and upload `dist/highlight-<version>.zip`. The script leaves the manifest's `key` out of the zip: that key only fixes the ID of the unpacked copy (`liacochebilhgigkfdjfacplcgpiohdf`), and the store gives the item its own ID. Keep `store/extension-key.pem` private and out of git.
- [ ] Have the screenshots from `store/screenshots/` ready (1280×800 PNG).

---

## Package

Upload `dist/highlight-<version>.zip` built by `store/package.ps1`.

## Store listing tab

**Summary** (from `manifest.json`, max 132 characters)

> Highlight text on any page, add notes, bookmark your place and mark what to learn later. Everything comes back when you return.

**Description**

```text
Highlight words and sentences on any web page, add your own notes, bookmark where you stopped reading, and mark what you want to learn more about. Everything is saved per page and comes back when you return.

HIGHLIGHT AS YOU READ
• Select text and pick one of five colors from the small toolbar, or press Alt+Shift+H.
• Click a highlight to recolor it, copy it, or remove it.
• Highlights come back automatically when you return to the page, even if the page has changed a little.

ADD NOTES
• Add a note to any highlight, right on the page. A small badge marks highlights with notes; hover to read the note.
• Edit notes on the page or in the library. Search and exports include them.

BOOKMARK YOUR PLACE
• Select a line and click the bookmark button to mark where you stopped. Each page keeps one bookmark.
• Next time, click the toolbar icon, then Jump to bookmark to go straight back to that line.

LEARN MORE LATER
• Found something you don't fully understand? Click the Learn more button (graduation cap) and write down your question.
• A "?" badge marks the passage on the page, and the To learn tab in the library collects these passages from every page.
• Click Got it once you understand. The highlight and your question stay.

ONE LIBRARY FOR EVERYTHING
• See every highlight from every page in Chrome's side panel (Alt+Shift+L) or in a full tab.
• Search highlight text, notes, page titles and sites. Filter by color. Sort by date, site or number of highlights.
• Browse page by page, as a timeline, or as your To learn list.
• Click any highlight to jump straight to it on its page.
• Recolor or delete from the library, with undo. Open tabs update instantly.

EXPORT AND BACK UP
• Export highlights, notes, bookmarks and Learn more items as Markdown.
• Save everything to a JSON backup and import it again, for example on another computer.

PRIVATE BY DESIGN
• Your highlights stay on your computer, in Chrome's local storage.
• No account, no servers, no tracking, no ads.

Works on most web pages. Chrome doesn't allow extensions on chrome:// pages, the Chrome Web Store or the built-in PDF viewer.
```

**Category:** Productivity (subcategory: Tools, if asked)

**Language:** English

**Store icon:** `icons/icon128.png` (128×128, 96×96 artwork with transparent padding)

**Screenshots** (in this order)

| File | Shows |
| --- | --- |
| `store/screenshots/1-highlight.png` | An article with highlights, note badges, a "?" (learn more) and a bookmark ribbon; the toolbar over a selection shows the note, bookmark and learn-more buttons |
| `store/screenshots/2-side-panel.png` | The side panel listing the page's highlights with notes, a Learn more item and the bookmark |
| `store/screenshots/3-bookmark.png` | The toolbar popup with Jump to bookmark |
| `store/screenshots/4-to-learn.png` | The library's To learn tab: passages marked to learn more, with questions, from several sites |
| `store/screenshots/5-learn.png` | Writing the question for a passage marked to learn more |

Small promo tile (440×280) and marquee (1400×560) are optional and not included.

## Privacy practices tab

**Single purpose**

> Highlight text on web pages, with optional notes, a bookmark per page and "learn more" marks; keep them on the user's device, and let the user browse, search and manage them in a library.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's highlights, the notes they add to them, and their settings in Chrome's local storage on their device. |
| `unlimitedStorage` | Lets large highlight libraries and imported backups exceed the default local storage quota. Data stays on the device. |
| `sidePanel` | Shows the highlight library in Chrome's side panel next to the page the user is reading. |
| `favicon` | Shows each page's icon next to its highlights in the library, using Chrome's local favicon cache. |
| Host permission (content script on `<all_urls>`) | The user can highlight text on any page they read, so the content script must run on all pages to draw highlights when text is selected and to restore saved highlights when a page is revisited. It only reads page text locally to find the highlighted passages; nothing is sent anywhere. |

**Remote code:** No, I am not using remote code. (All scripts are packaged in the extension.)

**Data usage — what user data do you collect?** The store counts data the extension stores locally as "handling" user data, even when it never leaves the device. Tick:

- [x] **Website content** — the highlighted text and a few characters around it, plus any note the user writes on a highlight.
- [x] **Web history** — the URL and title of pages where the user made a highlight, and when.

Leave everything else unticked (no personally identifiable, health, financial, authentication, communications, location or user activity data). Notes are text the user chooses to save next to a highlight, not keystroke logging, so they don't make it "user activity"; they're disclosed under website content and in the privacy policy.

**Certifications** — tick all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://preveengit.github.io/Highlight-and-Notes-Chrome-Extension/privacy-policy.html`

GitHub Pages publishes `docs/` from the `main` branch of `PreveenGit/Highlight-and-Notes-Chrome-Extension` (**Settings → Pages → Deploy from a branch → `main` / `docs`**), so pushing a change to `docs/privacy-policy.html` updates the page.

## Distribution tab

- **Payments:** Free
- **Visibility:** Public (or Unlisted to share by link first)
- **Regions:** All regions

## Test instructions tab (optional)

> No account or setup is needed. Open any article, select a sentence, and click a color in the toolbar that appears (or press Alt+Shift+H). Click the highlight to recolor or delete it. Reload the page: the highlight is restored. In the toolbar, the speech-bubble button adds a note, the bookmark button bookmarks the line (the toolbar icon's popup then shows Jump to bookmark), and the graduation-cap button marks a passage to learn more and asks for a question. Press Alt+Shift+L (or the side-panel button in the popup) to open the library; the To learn tab lists passages marked to learn more.
