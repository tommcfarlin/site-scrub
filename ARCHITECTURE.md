# Architecture & Limitations

This note captures the design decisions behind 🧽 Site Scrub and the constraints that
flow from them, so they read as intentional choices rather than surprises. It's
the written record of what the five review lenses (security, performance,
UI/UX, platform, QA) converged on.

## Files

| File | Responsibility |
|------|----------------|
| `manifest.json` | MV3 manifest: permissions, action (no popup), options page |
| `lib.js` | Host parsing (`hostnameFromUrl`, unit-tested) and the single history read (`searchAllHistory`). No `chrome.*` use at module load. |
| `background.js` | Service-worker orchestration: toolbar click → confirm → delete → indicator, plus the notification fallback and its durable handlers. |
| `injected-ui.js` | Functions injected into the active page (`dialogInPage`, `spongeSplashInPage`). Serialized by `executeScript`, so they are fully self-contained. |
| `options.js` / `options.html` / `options.css` | Settings screen: domains grouped by registrable domain with switches, expandable subdomains with Keep, search, debounced persistence. Light and dark from one stylesheet. |
| `options-model.js` | **Pure** view logic for the settings screen: counts after Keep, detail and summary text, search matching. Unit-tested. |
| `test/` | `lib.test.js` (pure logic) and `integration.test.js` (worker flow via a fake `chrome`). |

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

A toolbar click reads history **once** (`searchAllHistory`) and reuses that
array for: default selection (first run), matching (`collectMatches`), counts,
and the confirm message. Deletion runs in bounded batches (`deleteInChunks`) so
a large purge doesn't fire thousands of concurrent `deleteUrl` calls.

## Permissions (least privilege)

`history` (read + delete), `storage` (selection + session durability),
`scripting` + `activeTab` (inject on the active tab, only on a click — **no**
`host_permissions`/`<all_urls>`), `notifications` (fallback confirm + results).
No network access anywhere; history data never leaves the browser.

## Known limitations

- **Deletion is permanent.** The confirm is the only guardrail; there is no undo.
- **~90-day horizon.** Browsers retain a limited history window, so "everything"
  means everything still stored.
- **Internal pages** get the notification path, not the in-page dialog/overlay.
- **In-page dialogs are light-themed** regardless of the host page (legible over
  dark pages; intentionally not theme-matched).
- **"Items" = distinct URLs per hostname**, not per-visit rows as shown in
  `brave://history`. Consistent internally; a modeling choice.
- **Matching is by full hostname.** Selecting `facebook.com` does not remove
  `m.facebook.com`; each hostname is chosen independently in settings.
- **Mid-purge history changes** are tolerated (`deleteUrl` is idempotent), so the
  reported count can slightly exceed what was actually present.

## Testing

- **Unit** (`test/*.test.js`): host parsing edge cases (`lib.test.js`), domain
  matching and grouping with Keep (`match.test.js`), settings storage, and the
  settings-screen view logic (`options-model.test.js`).
- **Integration** (`integration.test.js`): the worker flow against a fake
  `chrome` — confirmed purge scope, cancel, empty selection, no-match, first-run
  defaults, the internal-page notification fallback (incl. Cancel), partial
  failure reporting, and the re-entrancy guard.
- **Manual**: browser-bound behavior (real injection, notifications, overlay,
  screen-reader/keyboard a11y, large-history profiling) per the checklist in
  `README.md`.

- **End-to-end** (`e2e/`, Playwright): the settings screen in real Chromium with
  the unpacked extension loaded and history seeded through the service worker.

Run unit tests with `npm test` and end-to-end tests with `npm run test:e2e`.
