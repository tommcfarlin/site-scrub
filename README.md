# 🧽 Site Scrub

A Brave/Chrome (Manifest V3) extension that scrubs selected sites from your
browsing history with one click.

## What it does

- **Settings screen** (right-click the icon → **Options**, or `brave://extensions`
  → Site Scrub → **Details** → **Extension options**): combs your entire available
  history on first load, lists every hostname **alphabetically** with an item
  count, and lets you check the ones to purge.
- **First-run defaults:** `facebook.com`, `reddit.com`, `linkedin.com`,
  `x.com`, and `twitter.com` (and their subdomains) are pre-checked.
- **One-click purge:** click the toolbar 🧽. A quick confirm appears in the
  current page, and on **Scrub** the matching history is permanently removed.
- **Indicator:** a 🧽 fades in at the top-right of the page, then fades out.

## Load it into Brave

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder
   (`site-scrub`).
4. The 🧽 icon appears in the toolbar. Click the puzzle-piece and **pin** it
   for easy access.
5. Right-click the icon → **Options** to review the site list before your
   first scrub.

## Testing

**Unit tests** cover the pure decision-logic in `lib.js` (what gets deleted):

```
npm test        # runs node --test over test/
```

**Manual checklist** for the browser-bound paths (which can't be unit-tested):

1. Load unpacked → open Options → confirm the list is alphabetical and the four
   defaults are pre-checked.
2. Compare a hostname's count against `brave://history`.
3. On a normal web page, click 🧽 → Cancel (default focus) → nothing deleted.
4. Click 🧽 → Tab to **Scrub** → confirm → items gone, 🧽 fades in/out.
5. Select nothing that exists → click 🧽 → "You have no sites to scrub" dialog.
6. Repeat on `brave://history` → confirm the notification fallback appears.
7. Keyboard-only + screen-reader pass over the confirm dialog and Options.

## Notes & limitations

- Browsers only keep roughly the last **90 days** of history, so "everything"
  means everything still stored.
- Deletion is **permanent** — the confirm dialog is the only undo.
- On internal pages (`brave://`, `chrome://`, the Web Store, the PDF viewer),
  the extension can't draw on the page, so the confirm and the "scrubbed"
  message appear as a **system notification** instead.
- The item count in settings is a per-hostname estimate; the confirm shows the
  exact number about to be removed.
