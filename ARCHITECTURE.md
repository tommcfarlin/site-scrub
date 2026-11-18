# Architecture & Limitations

This note records the design decisions behind 🧽 Site Scrub and the limits that follow from them.

## Files

| File | Responsibility |
|------|----------------|
| `manifest.json` | Manifest V3 (MV3) manifest. It declares permissions, optional `browsingData`, action (no popup), options page, service worker, and the fixed `key` (one extension id for every install). It also sets `minimum_chrome_version` 102 (for `storage.session`). |
| `background.js` | Service worker (the background script): toolbar click, dialog, delete, indicator, the notification fallback and its durable handlers, and the update-check listeners. |
| `lib.js` | Hostname parsing (`hostnameFromUrl`) and the single history read (`searchAllHistory`). No `chrome.*` use at module load. |
| `domains.js` | `registrableDomain`: the public suffix plus one label, using `psl-data.js`. |
| `psl-data.js` | Generated public suffix list (`exact`, `wildcard`, `exception` rules). Rebuilt by `scripts/build-psl.js`. Do not edit by hand. |
| `match.js` | `isScrubbed`, `collectMatches` (which history items a scrub removes, with Keep) and `groupByDomain` (the settings list). |
| `settings.js` | One `chrome.storage.local` key per setting. `sanitize` cleans every read and write. |
| `site-data.js` | Optional removal of cookies, cache, and site storage: permission checks, `planSiteData`, `removeSiteData`, and the words used in dialogs. |
| `updates.js` | The daily update check, the alarm, and the toolbar badge. |
| `version.js` | `parseVersion` and `compareVersions` for strict `major.minor.patch` strings. |
| `injected-ui.js` | Functions injected into the active page (`dialogInPage`, `spongeSplashInPage`). `executeScript` serializes them. Each is self-contained. |
| `options.html` / `options.css` / `options.js` | Settings page: domain switches, expandable subdomains with Keep, search, Advanced, update banner, debounced saves. Light and dark from one stylesheet. |
| `options-model.js` | Pure view logic for the settings page: counts after Keep, summary text, search matching, banner rule. |
| `scripts/build-psl.js` | Builds `psl-data.js` from a local copy of the public suffix list. Makes no network call. |
| `scripts/package.js` / `scripts/package-lib.js` | Build the release zip. `package-lib.js` holds the pure rules: which files ship and the missing-file checks. |
| `test/` | Unit tests, plus `integration.test.js` (worker flow with a fake `chrome`). |
| `e2e/` | Playwright tests in real Chromium, including the packaged zip. |
| `RELEASING.md` | The manual release steps. |

Shipped in the zip: the root `*.js` files except `playwright.config.js`, plus `manifest.json`, `options.html`, `options.css`, and `icons/`.

## Domain model

History is grouped by registrable domain: the public suffix (a domain ending such as `co.uk`) plus one label. `news.bbc.co.uk` belongs to `bbc.co.uk`. `registrableDomain` finds it from `psl-data.js`, which holds the whole public suffix list, private section included. IP addresses, single labels, and bare public suffixes have no registrable domain. Site Scrub never lists or scrubs them.

The user picks domains, not hostnames. A picked domain covers every subdomain under it.

**Keep.** The `kept` setting lists hostnames to protect. A kept host protects itself and all hosts under it. Keep always wins over the domain switch. `isScrubbed` in `match.js` applies this rule for the scrub. `isKept` and `domainView` in `options-model.js` apply the same rule for the counts in settings.

## Key design decision: the in-page injection model

Site Scrub shows its dialog and the 🧽 indicator by **injecting them into the
active tab** via `chrome.scripting.executeScript` (granted per-click by
`activeTab`). Site Scrub needs no standing host permissions. This one choice is the
root of most trade-offs below.

**Consequence: a dual dialog path.** Content scripts cannot be injected into
internal pages (`brave://`, `chrome://`, the Web Store, the PDF viewer). When a
privacy-minded user reaches for Site Scrub, that user is often *on* `brave://history`.
Site Scrub therefore has a second path:

1. **Normal pages:** inject `dialogInPage` (in-page dialog) and, on success,
   `spongeSplashInPage` (the 🧽 + a visually-hidden live-region announcement).
2. **Internal pages:** fall back to a system **notification** with Scrub/Cancel
   buttons.

**Consequence: durability via `storage.session`.** A `requireInteraction`
notification can outlive the service worker. MV3 evicts idle workers. The
pending scrub is saved to `chrome.storage.session`, keyed by notification id.
The decision is handled by **top-level** `notifications.onButtonClicked` /
`onClosed` listeners. These listeners survive a restart. An in-memory promise does not.

**Consequence: the in-page dialog is a convenience guard, not a security
boundary.** Injected nodes share the page's DOM. The dialog uses a *closed*
shadow root and an `isTrusted` check on the destructive button. A hostile page
cannot press that button automatically, and the dialog fails closed. A page can
still remove the host node, which cancels the scrub. The page never controls the
scope of a scrub. The saved selection in the worker sets it.

## Data flow (one scan for the dialog, one re-check after it)

A toolbar click reads history once (`searchAllHistory`) and reuses that array for matching (`collectMatches`), counts, and the dialog text. The first-run defaults come from `settings.js` (an absent `domains` key), not from history.

**The dialog is binding.** The dialog records what it showed. It stores the number of history items, the data types it named, and the `domains` and `kept` it was built from. The in-page dialog keeps this in memory. For a notification, the record sits in the `pendingPurge:<notificationId>` session key. After Scrub, `recheck` reads history and settings again. It matches only domains that the dialog listed and that are still on, and honors Keep entries from both. If the item count or the data types differ from the dialog, nothing is deleted. A scrub never removes more, or other kinds of data, than the user agreed to.

A notification says "Something changed while you were deciding. Click the sponge again to review".

If nothing matches any more, it says "You have no sites to scrub".

The notification's pending record is written before the notification is created (with an id chosen in advance). An instant Scrub click therefore finds it. Each notification has its own session key. Records never overwrite each other.

Deletion runs in bounded batches (`deleteInChunks`). This keeps a large scrub from firing thousands of concurrent `deleteUrl` calls.

## Permissions (least privilege)

- `history`: read and delete.
- `storage`: settings, and `storage.session` for the pending notification decision.
- `scripting` and `activeTab`: inject into the active tab, only after a click. There are no `host_permissions` and no `<all_urls>`.
- `notifications`: the fallback dialog and the results.
- `alarms`: the daily update check.
- Optional `browsingData`: the browser asks for it the first time the user turns on cookies, cached files, or site storage. `ensurePermission` runs inside the click handler of the switch. The request needs a user gesture. If the user refuses, the switch stays off. If the permission is later withdrawn, a scrub skips those types and says so in the dialog and the result.

**Cookies and Keep.** `chrome.browsingData.remove` with an `origins` filter clears cookies for the whole registrable domain of each origin, not for one host. A cookie removal for `www.example.com` also clears cookies that `kept.example.com` uses. `planSiteData` leaves cookies alone for any domain that has a kept host. Cache and site storage are per origin. They still go. The dialog text tells the user how many sites kept their cookies.

## Update check

`updates.js` runs from a daily `chrome.alarms` alarm. It fetches `https://pressware.co/extensions/site-scrub/version.json`, which holds `{"version":"x.y.z"}`, with `cache: "no-store"` and `credentials: "omit"`. It sends no identifier. Any failure is silent. A newer version is saved as `latestVersion`. The toolbar badge and the settings banner both read it.

**A fixed extension id.** A cross-origin fetch from the service worker sends `Origin: chrome-extension://<id>`. Without a manifest `key`, Chrome makes an unpacked extension's id from its install folder path. Each user then gets a different id. That id stays the same every day. It works as an identifier in the server logs. To prevent this, `manifest.json` has a fixed `key`. The key is a public key only. The private key was discarded. Unpacked and zip installs do not need it. Every install has the same id, `okelcjddfojjpngggcankijeagakaegf`. The daily request then shows only that shared id and the user's IP address, nothing that identifies the user. When the user moves the folder, the settings stay as a side effect. The browser stores them under the id.

The fetch needs no host permission. The service worker makes a plain cross-origin read, and the server allows it with an `Access-Control-Allow-Origin` header. If the server stops sending that header, the check fails silently and no update shows. The request carries no user data. When the user turns the check off, no request is made and the badge clears. The banner has a Later button, which saves `dismissedVersion` and hides the banner until a still newer version appears.

Nothing downloads or installs code. The banner links to the download page, and the user replaces the folder by hand.

## Known limitations

- **Deletion is permanent.** The dialog is the only guardrail. There is no undo.
- **~90-day horizon.** Browsers retain a limited history window. "Everything"
  means everything still stored.
- **Internal pages** get the notification path, not the in-page dialog/overlay.
- **In-page dialogs are light-themed** regardless of the host page. This keeps them legible over
  dark pages. They are intentionally not theme-matched.
- **"Items" = distinct URLs per hostname**, not per-visit rows as shown in
  `brave://history`. The count is consistent internally. It is a modeling choice.
- **Matching is by registrable domain.** Turning on `facebook.com` scrubs `m.facebook.com` too. Use Keep to protect a subdomain.
- **History that changes during the deletion itself** (after the re-check): Site Scrub
  tolerates it. `deleteUrl` is idempotent. The reported count can slightly
  exceed what was actually present. Changes while the dialog is open abort the scrub.
- **Sites in messages are registrable domains** (`countSites`), the same unit as
  the settings page: `facebook.com` and `m.facebook.com` are one site.

## Testing

- **Unit** (`test/*.test.js`) covers hostnames, public suffix lookup, matching and grouping with Keep, settings storage and sanitizing, and site data planning. It also covers version compare, the update check, the settings view logic, and the packaging rules. The manifest test (`manifest.test.js`) checks that the fixed key gives the expected id.
- **Integration** (`integration.test.js`): the worker flow against a fake `chrome`. It covers scrub scope, cancel, empty selection, no match, and first-run defaults. It also covers the notification fallback, partial failure, and the re-entrancy guard. The re-check after the dialog covers new history, a new Keep, a changed permission or data type, and a domain turned off. Each notification has one pending key.
- **End-to-end** (`e2e/`, Playwright, a browser test tool): the settings page in real Chromium with the extension loaded and history seeded through the service worker. One test builds the zip, unpacks it, loads the unpacked copy, and opens the settings page.
- **Manual**: browser-bound behavior (real injection, notifications, overlay, keyboard and screen-reader use) per the checklist in `README.md`.

Run unit tests with `npm test` and end-to-end tests with `npm run test:e2e`.
