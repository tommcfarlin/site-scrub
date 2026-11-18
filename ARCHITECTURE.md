# Architecture & Limitations

This note records the design decisions behind 🧽 Site Scrub and the limits that follow from them.

## Files

| File | Responsibility |
|------|----------------|
| `manifest.json` | MV3 manifest: permissions, optional `browsingData`, action (no popup), options page, service worker |
| `background.js` | Service worker: toolbar click, confirm, delete, indicator, the notification fallback and its durable handlers, and the update-check listeners. |
| `lib.js` | Hostname parsing (`hostnameFromUrl`) and the single history read (`searchAllHistory`). No `chrome.*` use at module load. |
| `domains.js` | `registrableDomain`: the public suffix plus one label, using `psl-data.js`. |
| `psl-data.js` | Generated public suffix list (`exact`, `wildcard`, `exception` rules). Rebuilt by `scripts/build-psl.js`. Do not edit by hand. |
| `match.js` | `isScrubbed`, `collectMatches` (which history items a scrub removes, with Keep) and `groupByDomain` (the settings list). |
| `settings.js` | One `chrome.storage.local` key per setting. `sanitize` cleans every read and write. |
| `site-data.js` | Optional removal of cookies, cache, and site storage: permission checks, `planSiteData`, `removeSiteData`, and the words used in dialogs. |
| `updates.js` | The daily update check, the alarm, and the toolbar badge. |
| `version.js` | `parseVersion` and `compareVersions` for strict `major.minor.patch` strings. |
| `injected-ui.js` | Functions injected into the active page (`dialogInPage`, `spongeSplashInPage`). `executeScript` serializes them, so each is self-contained. |
| `options.html` / `options.css` / `options.js` | Settings page: domain switches, expandable subdomains with Keep, search, Advanced, update banner, debounced saves. Light and dark from one stylesheet. |
| `options-model.js` | Pure view logic for the settings page: counts after Keep, summary text, search matching, banner rule. |
| `scripts/build-psl.js` | Builds `psl-data.js` from a local copy of the public suffix list. Makes no network call. |
| `scripts/package.js` / `scripts/package-lib.js` | Build the release zip. `package-lib.js` holds the pure rules: which files ship and the missing-file checks. |
| `test/` | Unit tests, plus `integration.test.js` (worker flow with a fake `chrome`). |
| `e2e/` | Playwright tests in real Chromium, including the packaged zip. |
| `RELEASING.md` | The manual release steps. |

Shipped in the zip: the root `*.js` files except `playwright.config.js`, plus `manifest.json`, `options.html`, `options.css`, and `icons/`.

## Domain model

History is grouped by registrable domain: the public suffix plus one label. `news.bbc.co.uk` belongs to `bbc.co.uk`. `registrableDomain` finds it from `psl-data.js`, which holds the whole public suffix list, private section included. IP addresses, single labels, and bare public suffixes have no registrable domain, so they are never listed or scrubbed.

The user picks domains, not hostnames. A picked domain covers every subdomain under it.

**Keep.** The `kept` setting lists hostnames to protect. A kept host protects itself and all hosts under it. Keep always wins over the domain switch. `isScrubbed` applies this rule for both the scrub and the counts in settings.

## Key design decision: the in-page injection model

Site Scrub shows its confirm dialog and the 🧽 indicator by **injecting them into the
active tab** via `chrome.scripting.executeScript` (granted per-click by
`activeTab`, so no standing host permissions are needed). This one choice is the
root of most trade-offs below.

**Consequence — a dual confirm path.** Content scripts cannot be injected into
internal pages (`brave://`, `chrome://`, the Web Store, the PDF viewer). Since a
privacy-minded user is often *on* `brave://history` when they reach for Site Scrub,
there is a second path:

1. **Normal pages:** inject `dialogInPage` (in-page confirm) and, on success,
   `spongeSplashInPage` (the 🧽 + a visually-hidden live-region announcement).
2. **Internal pages:** fall back to a system **notification** with Scrub/Cancel
   buttons.

**Consequence — durability via `storage.session`.** A `requireInteraction`
notification can outlive the service worker (MV3 evicts idle workers). So the
pending purge is persisted to `chrome.storage.session` keyed by notification id,
and the decision is handled by **top-level** `notifications.onButtonClicked` /
`onClosed` listeners that survive a restart — not by an in-memory promise.

**Consequence — the in-page confirm is a convenience guard, not a security
boundary.** Injected nodes share the page's DOM. It's hardened with a *closed*
shadow root and an `isTrusted` check on the destructive button (so a hostile
page can't auto-confirm), and it fails closed. But a page can still remove the
host node (which simply cancels). The scope of a purge is never page-controlled
— it comes from the saved selection in the worker.

## Data flow (one scan per action)

A toolbar click reads history once (`searchAllHistory`) and reuses that array for first-run defaults, matching (`collectMatches`), counts, and the confirm text. Deletion runs in bounded batches (`deleteInChunks`) so a large scrub does not fire thousands of concurrent `deleteUrl` calls.

## Permissions (least privilege)

- `history`: read and delete.
- `storage`: settings, and `storage.session` for the pending notification decision.
- `scripting` and `activeTab`: inject into the active tab, only after a click. There are no `host_permissions` and no `<all_urls>`.
- `notifications`: the fallback confirm and the results.
- `alarms`: the daily update check.
- Optional `browsingData`: asked for the first time the user turns on cookies, cached files, or site storage. `ensurePermission` runs inside the click handler of the switch, because the request needs a user gesture. If the user refuses, the switch stays off. If the permission is later withdrawn, a scrub skips those types and says so in the confirm and the result.

**Cookies and Keep.** `chrome.browsingData.remove` with an `origins` filter clears cookies for the whole registrable domain of each origin, not for one host. A cookie removal for `www.example.com` also clears cookies that `kept.example.com` uses. So `planSiteData` leaves cookies alone for any domain that has a kept host. Cache and site storage are per origin, so they still go. The confirm text tells the user how many sites kept their cookies.

## Update check

`updates.js` runs from a daily `chrome.alarms` alarm. It fetches `https://pressware.co/extensions/site-scrub/version.json`, which holds `{"version":"x.y.z"}`, with `cache: "no-store"` and `credentials: "omit"`. It sends no identifier. Any failure is silent. A newer version is saved as `latestVersion`. The toolbar badge and the settings banner both read it.

The fetch needs no host permission. The service worker makes a plain cross-origin read, and the server allows it with an `Access-Control-Allow-Origin` header. If the server stops sending that header, the check fails silently and no update shows. The request carries no user data. When the user turns the check off, no request is made and the badge clears. The banner has a Later button, which saves `dismissedVersion` and hides the banner until a still newer version appears.

Nothing downloads or installs code. The banner links to the download page, and the user replaces the folder by hand.

## Known limitations

- **Deletion is permanent.** The confirm is the only guardrail; there is no undo.
- **~90-day horizon.** Browsers retain a limited history window, so "everything"
  means everything still stored.
- **Internal pages** get the notification path, not the in-page dialog/overlay.
- **In-page dialogs are light-themed** regardless of the host page (legible over
  dark pages; intentionally not theme-matched).
- **"Items" = distinct URLs per hostname**, not per-visit rows as shown in
  `brave://history`. Consistent internally; a modeling choice.
- **Matching is by registrable domain.** Turning on `facebook.com` scrubs `m.facebook.com` too. Use Keep to protect a subdomain.
- **Mid-purge history changes** are tolerated (`deleteUrl` is idempotent), so the
  reported count can slightly exceed what was actually present.

## Testing

- **Unit** (`test/*.test.js`): hostnames, public suffix lookup, matching and grouping with Keep, settings storage and sanitizing, site data planning, version compare, the update check, the settings view logic, and the packaging rules.
- **Integration** (`integration.test.js`): the worker flow against a fake `chrome`: scrub scope, cancel, empty selection, no match, first-run defaults, the notification fallback, partial failure, and the re-entrancy guard.
- **End-to-end** (`e2e/`, Playwright): the settings page in real Chromium with the extension loaded and history seeded through the service worker. One test builds the zip, unpacks it, loads the unpacked copy, and opens the settings page.
- **Manual**: browser-bound behavior (real injection, notifications, overlay, keyboard and screen-reader use) per the checklist in `README.md`.

Run unit tests with `npm test` and end-to-end tests with `npm run test:e2e`.
