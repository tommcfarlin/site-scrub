# 🧽 Site Scrub

A Brave and Chrome (Manifest V3) extension that scrubs the sites you pick from your browsing history with one click.

## What it does

- **Settings page.** Open it from the toolbar icon (right-click, then **Options**), or from `brave://extensions` → Site Scrub → **Details** → **Extension options**. It reads your whole available history and lists every site, in alphabetical order, with an item count.
- **Domains with subdomains.** Each row is a registrable domain, such as `facebook.com`. Turn it on and Site Scrub scrubs the domain and every subdomain under it, such as `m.facebook.com`. The list of public suffixes (so `bbc.co.uk` is one site, not `co.uk`) is built in.
- **Keep.** Open a row to see its subdomains. Use **Keep** on a subdomain to protect it. Keep wins over the domain switch, and a kept host also keeps everything under it.
- **First-run defaults.** `facebook.com`, `reddit.com`, `linkedin.com`, `x.com`, and `twitter.com` start turned on.
- **One-click scrub.** Click the 🧽 in the toolbar. A confirm box appears in the page. Press **Scrub** and the matching history is removed for good. A 🧽 fades in and out when it is done.
- **Advanced options.** Open **Advanced** on the settings page to also remove cookies, cached files, and site storage for the scrubbed sites. History is always removed. Removing cookies or site storage can sign you out of those sites. Your browser asks for the extra permission the first time you turn one of these on. Cookies are skipped for a domain that has a kept subdomain, because the browser clears cookies for a whole domain at once.
- **Update check.** Once a day Site Scrub reads one version number from `pressware.co`. When a newer version exists, the toolbar icon shows a dot and the settings page shows a banner. Turn this off in **Advanced** → **Check for updates**.

## Install from the zip

1. Download `site-scrub-<version>.zip` from the Site Scrub page on pressware.co (<https://pressware.co/extensions/site-scrub/>). The same zip is also on the GitHub release page.
2. Unzip it. Keep the folder somewhere permanent. The browser reads the extension from that folder every time it starts.
3. Open `brave://extensions` (or `chrome://extensions`).
4. Turn on **Developer mode** (top-right switch).
5. Click **Load unpacked** and choose the unzipped folder.
6. Pin the 🧽 icon from the puzzle-piece menu.
7. Right-click the icon, then **Options**. Review the list before your first scrub.

## Update

When the banner or the toolbar dot appears:

1. Download the new zip from the Site Scrub page on pressware.co (the banner links to it). The same zip is also on the GitHub release page.
2. Unzip it over the old folder, or into a new folder.
3. Open `brave://extensions`. If you used the old folder, click the reload button on Site Scrub. If you used a new folder, click **Load unpacked** and choose the new folder. It replaces the old copy. Then you can delete the old folder.

Your settings stay. The browser keeps them apart from the extension folder, under the extension id. Every copy of Site Scrub has the same id (the manifest sets it), so the settings stay even when you move the folder. This was tested in Chromium. You can check it in Brave by moving the folder and choosing **Load unpacked** again. Do not click **Remove** on Site Scrub: that deletes its settings.

## Privacy

- Site Scrub stores your settings in `chrome.storage.local`, on your computer: the sites you picked, your Keep list, the Advanced switches, the update-check switch, and the newest version number it saw.
- Your history never leaves the browser.
- The only network request is the daily update check. It is a plain read of `https://pressware.co/extensions/site-scrub/version.json`. The request has no cookies and nothing that names you. The browser adds the extension id, and every copy of Site Scrub has the same id. Like any web request, the version check shows your IP address to the web host. If you turn the check off, Site Scrub makes no network request at all.
- Site Scrub asks for no access to the sites you visit. It draws on the page you are on only when you click the icon.

## Development

- `npm test` runs the type check (`tsc`) and the unit tests.
- `npm run test:e2e` runs the Playwright tests in a real Chromium with the extension loaded.
- `npm run package` builds the release zip in `dist/`.
- `RELEASING.md` lists the release steps. `ARCHITECTURE.md` explains the design.

### Manual checklist

These paths need a real browser:

1. Load unpacked, open Options, and confirm the list is alphabetical and the defaults are on.
2. Compare a site's count against `brave://history`.
3. On a normal page, click 🧽, then Cancel. Nothing is deleted.
4. Click 🧽, Tab to **Scrub**, and confirm. The items are gone and the 🧽 fades in and out.
5. Turn every site off, click 🧽, and see the "no sites" message.
6. Repeat on `brave://history` and confirm the notification fallback.
7. Do a keyboard-only and screen-reader pass over the confirm box and the settings page.

## Limits

- Browsers keep about 90 days of history. "Everything" means everything still stored.
- Scrubbing is permanent. The confirm box is the only guard.
- On internal pages (`brave://`, `chrome://`, the Web Store, the PDF viewer) the extension cannot draw on the page. The confirm and the result appear as a system notification instead.
- The count in settings is a per-site estimate. The confirm shows the exact number about to be removed.
