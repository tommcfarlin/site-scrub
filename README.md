# 🧽 Site Scrub

Site Scrub is a Manifest V3 extension for Brave and Chrome. It scrubs (permanently removes) the browsing history of the sites you pick, in one click.

## What it does

- **Settings page.** Open it from the toolbar icon: right-click the icon, then choose **Options**. You can also open `brave://extensions`, choose Site Scrub, then **Details**, then **Extension options**. The page reads your whole available history and lists every site in alphabetical order, with an item count.
- **Domains with subdomains.** Each row is a registrable domain (the main domain name), such as `facebook.com`. Turn on a row and Site Scrub scrubs the domain and every subdomain under it, such as `m.facebook.com`. The built-in list of public suffixes (domain endings such as `co.uk`) treats `bbc.co.uk` as one site, not `co.uk`.
- **Keep.** Open a row to see its subdomains. Press **Keep** on a subdomain to protect it from scrubbing. Keep wins over the domain switch. A kept host also protects everything under it.
- **First-run defaults.** `facebook.com`, `reddit.com`, `linkedin.com`, `x.com`, and `twitter.com` start turned on.
- **One-click scrub.** Click the 🧽 in the toolbar. A dialog appears in the page. Press **Scrub** to remove the matching history for good. When the scrub finishes, the 🧽 fades in and out.
- **Advanced options.** Open **Advanced** on the settings page to also remove cookies, cached files, and site storage for the scrubbed sites. Cached files are saved copies of pages. Site storage is data that sites save in your browser. Site Scrub always removes history. Removing cookies or site storage can sign you out of those sites. Your browser asks for the extra permission the first time you turn one of these on. Site Scrub skips cookies for any domain with a kept subdomain. The browser clears cookies for a whole domain at once.
- **Update check.** Once a day Site Scrub reads one version number from `pressware.co`. When a newer version exists, the toolbar icon shows a dot and the settings page shows a banner. To turn it off, open **Advanced** and turn off **Check for updates**.

## Install from the zip

1. Download `site-scrub-<version>.zip` from the Site Scrub page on pressware.co (<https://pressware.co/extensions/site-scrub/>). The same zip is also on the GitHub release page.
2. Unzip it. Keep the folder somewhere permanent. The browser reads the extension from that folder every time it starts.
3. Open `brave://extensions` (or `chrome://extensions`).
4. Turn on **Developer mode** (top-right switch).
5. Click **Load unpacked** and choose the unzipped folder.
6. Pin the 🧽 icon from the puzzle-piece menu.
7. Right-click the icon, then choose **Options**. Before your first scrub, review the list.

## Update

When the banner or the toolbar dot appears:

1. Download the new zip from the Site Scrub page on pressware.co (the banner links to it). The same zip is also on the GitHub release page.
2. Unzip it over the old folder, or into a new folder.
3. Open `brave://extensions`. If you used the old folder, click the reload button on Site Scrub. If you used a new folder, click **Load unpacked** and choose the new folder. It replaces the old copy. Then you can delete the old folder.

Your settings stay. The browser stores them apart from the extension folder, under the extension id. The manifest sets one id for every copy of Site Scrub. When you move the folder, the settings stay. We tested this in Chromium. To check it in Brave, move the folder and choose **Load unpacked** again. Do not click **Remove** on Site Scrub. That action deletes its settings.

## Privacy

- Site Scrub stores your settings on your computer, in `chrome.storage.local` (the browser's local storage area). The settings are the sites you picked, your Keep list, the Advanced switches, the update-check switch, and the newest version number it saw.
- Your history never leaves the browser.
- The only network request is the daily update check. It makes a plain read of `https://pressware.co/extensions/site-scrub/version.json`. The request has no cookies and nothing that names you. The browser adds the extension id, and every copy of Site Scrub has the same id. Like any web request, the version check shows your IP address to the web host. If you turn off the check, Site Scrub makes no network request at all.
- Site Scrub asks for no access to the sites you visit. When you click the icon, Site Scrub draws on the page you are on, and at no other time.

## Development

- `npm test` runs the type check (`tsc`, the TypeScript compiler) and the unit tests.
- `npm run test:e2e` runs the Playwright (browser test tool) tests in a real Chromium with the extension loaded.
- `npm run package` builds the release zip in `dist/`.
- `RELEASING.md` lists the release steps. `ARCHITECTURE.md` explains the design.

### Manual checklist

These paths need a real browser:

1. Load unpacked, open Options, and check that the list is alphabetical and the defaults are on.
2. Compare a site's count against `brave://history`.
3. On a normal page, click 🧽, then Cancel. Site Scrub deletes nothing.
4. Click 🧽, Tab to **Scrub**, and press it. Check that the items are gone. The 🧽 fades in and out.
5. Turn every site off, click 🧽, and see the "no sites" message.
6. Repeat on `brave://history` and check the notification fallback.
7. Do a keyboard-only and screen-reader pass over the dialog and the settings page.

## Limits

- Browsers keep about 90 days of history. "Everything" means everything still stored.
- Scrubbing is permanent. The dialog is the only guard.
- On internal browser pages (`brave://`, `chrome://`, the Web Store, the PDF viewer), the extension cannot draw on the page. The dialog and the result appear as a system notification instead.
- The count in settings is a per-site estimate. The dialog shows the exact number that Site Scrub will remove.
