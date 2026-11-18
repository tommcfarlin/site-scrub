# Site Scrub 1.0 Design

Date: 2026-11-18
Status: Draft, waiting for approval

## Intent and why

Site Scrub is a Brave and Chrome extension. One click on the toolbar icon removes the history of sites that you chose.

The extension works today, and the author likes its basics. The author wants it to become sturdier and still simple. The north star is simplicity. A new user installs it, keeps the defaults, and clicks the sponge.

Two problems drive this work. First, matching is by exact hostname. A user who selects facebook.com still has m.facebook.com in history. Second, the extension removes history only. Cookies, cached files, and site storage stay in the browser.

## Goals

- Scrubbing a primary domain removes the domain and every subdomain under it.
- The settings page lists primary domains, not every hostname. A user can expand a domain to see its subdomains.
- A user can mark any subdomain as Keep. Keep always wins over scrub.
- An Advanced section lets a user also remove cookies, cached files, and site storage. This setting is global.
- The extension tells the user about each newer version.
- The project runs on a repeatable release process with automated unit, integration, and end-to-end tests.

## Non-goals

- Firefox support.
- A Chrome Web Store listing. This is a later milestone. The author does not want to pay the developer fee now.
- Choosing what to remove per domain. The global setting ships first, and per-domain choice is a future feature.
- Undo. History deletion cannot be reversed, and the extension will not store a copy of deleted history.
- A build step, TypeScript, or a UI framework.

## Anti-goals

Each outcome below is a failure. The code can pass every test and still fail this way.

- A user is signed out of a site without having chosen to remove cookies.
- The scrub dialog states a count that differs from what the extension removes.
- Any history data leaves the browser.
- An item under a Keep subdomain is deleted.

## Constraints

- Manifest V3. Vanilla JavaScript with ES modules. No build step and no runtime dependencies.
- Type checking uses JSDoc comments and `// @ts-check`. The command `tsc --noEmit` runs as part of `npm test`. The shipped files are identical to the source files.
- Least privilege. The install warning must not grow for users who never use the Advanced section.
- The injected UI functions in `injected-ui.js` must stay self-contained, because `executeScript` serializes their source.
- The GitHub repository is private during development. When the work is done, it becomes open source.
- Version 1.0.0 ships as a zip file attached to a GitHub release. Users load it in developer mode.

## Approaches considered

Approach A is vanilla JavaScript with JSDoc type checking. Approach B is TypeScript with Vite. The author chose A.

- A keeps the shipped code readable and identical to the source. That matters for a tool that deletes data. It also keeps the tested code as it is.
- B adds types, easy use of npm packages, and fast reload during development. It also adds a build step and minified output, and it requires a larger rewrite. The project has no dependencies that justify these costs.
- Trigger to revisit: if the project gains real runtime dependencies or a UI framework, add Vite.

## Design

### Domain model

The user picks registrable domains. A registrable domain is the part of a hostname that a person can own, such as facebook.com or bbc.co.uk. The extension finds it with the public suffix list. The list is a generated JavaScript file that lives in the repository, so the extension needs no network access for this. A script regenerates the file from the published list. The release process runs that script.

When both of these are true, the extension scrubs a history item:

1. The registrable domain of its hostname is in the user's domain list.
2. No Keep entry matches the hostname. A Keep entry matches its own hostname and every hostname under it.

If a Keep entry is a.work.facebook.com, then b.a.work.facebook.com is also kept. The settings page does not offer Keep on the registrable domain itself. To protect the whole domain, the user clears its checkbox.

The first-run defaults are facebook.com, reddit.com, linkedin.com, x.com, and twitter.com. Hostnames that are IP addresses or single labels have no registrable domain. The extension never scrubs them.

### Settings page

Each row shows a checkbox, the domain, an item count, and the number of subdomains. A user expands a row to see each subdomain with its own count and a Keep switch. A short note says that choosing a domain also scrubs everything under it. Rows are alphabetical. The Advanced section is collapsed by default.

```
[x] facebook.com        312 items  (4 subdomains)  v
      m.facebook.com        140    Keep [ ]
      work.facebook.com      60    Keep [x]
Note: choosing a domain also scrubs everything under it.
```

### Advanced section

The Advanced section holds these controls:

- Also remove cookies, cached files, and site storage. Each type has its own checkbox. All are off by default.
- Check for updates. This is on by default.

The history-only default is deliberate. Removing cookies signs the user out of those sites, so the user must choose it.

The scrub dialog names what will be removed, for example "history and cookies from 4 sites". The count excludes Keep items.

### Removing cookies, cache, and storage

The extension uses `chrome.browsingData.remove` with an `origins` filter. It builds the origin list from the hostnames that the scrub matched, with both the https and http form of each. Deleting history cannot use this filter, so history deletion stays on `chrome.history.deleteUrl`.

The `browsingData` permission is optional. When the user first turns on a data type, the extension asks for it. If the user denies it, the checkbox stays off.

Risk for the builder to test early: cookies set for a parent domain, such as `.facebook.com`, can survive an origin-filtered removal. Build a small spike first. If the filter does not remove them, the fallback is the `chrome.cookies` API, which needs host permissions. In that case, stop and bring the decision back to the author, because the install warning changes.

### Update check

- The extension reads `https://pressware.co/extensions/site-scrub/version.json` about once a day. A `chrome.alarms` alarm drives this.
- The file holds one object, such as `{"version":"1.0.0"}`. The file lives in the pressware.co repository and changes with each release.
- If the number is higher than the installed version, the extension sets a badge on the toolbar icon. It also shows a banner on the settings page. The banner links to the GitHub release.
- The request carries no identifier and no data about the user. A failed request is silent.
- GitHub Pages sends permissive CORS headers, so the fetch likely needs no host permission. The builder must test this. If a host permission is required, limit it to that one path.
- A hand-loaded extension cannot update itself. The user downloads the new zip, replaces the folder, and reloads the extension.
- The privacy page on pressware.co must describe this request in plain words.

### Storage

The old `selected` key is removed. The new keys are:

- `domains`: array of registrable domains.
- `kept`: array of hostnames.
- `alsoRemove`: object with a boolean per data type.
- `updateCheck`: boolean.
- `latestVersion`: string, written by the update check.

No migration is needed, because no release exists yet. The builder must read every stored value as untrusted. Only strings and booleans of the expected shape are accepted.

## Settings page visual design

The author approved a mockup on 2026-11-18. It is a private artifact: https://claude.ai/artifact/HWgM7mwhajBv2xAh51kEg8. It has a light board, a dark board with Advanced open and the update banner shown, and a style guide. The goal is a settings page that looks like Apple made it. It must be simple, quiet, and easy to read. The sponge emoji 🧽 is the brand mark.

Rules from the mockup:

- Layout: one centered column, 680 px wide. A logo tile, a large title, and one plain sentence come first. Then a grouped card holds the domain list.
- The logo tile is a rounded square with a soft yellow gradient and a 🧽 at 44 px. The tile is the only decoration on the page.
- Colors for light mode: ground #F5F5F7, card #FFFFFF, text #1D1D1F, muted text #6E6E73, accent #0071E3.
- Colors for dark mode: ground #000000, card #1C1C1E, text #F5F5F7, muted text #98989F, accent #0A84FF.
- One accent color serves every control. Red appears only on the Scrub button in the scrub dialog.
- Both themes follow the browser setting.
- Fonts: the system font stack, which is SF Pro on a Mac, with Inter as the fallback. No font files ship with the extension.
- Type scale: title 40/44 bold, subtitle 19/28, row title 17/22, row detail 13/18, section label 13/18 semibold in capitals.
- Cards have 14 px corners and no borders. Rows are 64 px tall with hairline dividers. Switches follow the Apple style, in the accent color.
- Each domain row shows the domain, a detail line, the count of items that will be removed, a switch, and a chevron. The count excludes Keep items.
- A search box sits at the top of the domain list. This is new, and the author kept it. A long history can hold hundreds of domains.
- Advanced is a collapsed row. When open, it shows three switches (cookies, cached files, site storage), a note that the browser asks for permission, and the update-check switch.
- The update banner shows at the top of the page. It names the new version, links to the download, and offers Later.
- The copy is short and plain. The footer says that scrubbing is permanent and that history never leaves the browser.

The scrub dialog injected into pages keeps the same style in a later milestone. This section covers the settings page only.

The page must meet these rules:

- Text meets WCAG AA contrast.
- Every control has a label and works with the keyboard.
- The page respects reduced motion for the switch animation.

## Milestones

### 1.0.0

- Public suffix list, domain model, and matching with Keep.
- Settings page with domains, expandable subdomains, and Keep.
- Advanced section with data types and the optional permission.
- Scrub dialog text with correct counts.
- Update check, badge, and banner.
- JSDoc type checking in `npm test`.
- End-to-end tests and release plumbing: zip build, GitHub release, version file update.

### 1.1.0

- Scrub automatically at browser start and on a schedule. This is off by default and shows a notification of what it removed.
- The browser gives an extension no dependable close event. So "on close" means "on next start".
- A "scrub this site now" action for the current tab.
- A toolbar badge with the count of items waiting. The extension computes it on an alarm, not on every page visit, to protect performance.
- A preview list of sites and counts before deletion.
- Better handling of very large histories. The extension reads history in time windows, not in one call with a limit of 1,000,000 items.

### Later

- Chrome Web Store listing.
- Per-domain choice of what to remove.

## Process

- The GitHub repository is private, with a milestone for each release above.
- Each feature, bug, or task has one issue. Titles and labels use the commit-lint format.
- Each issue has three sections: a plain summary, instructions for agents, and acceptance criteria. The criteria say what must pass in unit tests and in end-to-end tests.
- Branching: `release/1.0.0` is cut from `master`. Each issue gets its own branch or worktree from the release branch. When all issues are merged and all tests pass, the release is ready.
- A separate piece of work builds the Site Scrub page on pressware.co, under `extensions/site-scrub/`. It follows the pattern of the other pages there: index, privacy, and terms.

## Testing

- Unit tests cover the pure logic in `lib.js`: parsing, registrable domains, matching, Keep, and version comparison.
- Integration tests run the service-worker flow against a fake `chrome`, as they do today.
- End-to-end tests load the unpacked extension in Chromium with Playwright. The tests add history items through the extension's own context and then drive the toolbar click and the settings page. Headless extension support needs the new headless mode, and the builder must make sure that the setup works.
- The manual list in `README.md` stays for paths that no tool can test, such as screen-reader use.

## Left to the builder

- The exact layout and styling of the new settings rows.
- The format of the public suffix list file and the script that makes it.
- The format of the badge, such as a dot or short text.
- The structure of the end-to-end test code.

## Calls made without the author

The author did not decide these items. They are proposals, and the author can change any of them.

- Keep applies to the hostname and everything under it.
- Keep is not offered on the registrable domain itself.
- Update check is on by default, with a switch in Advanced.
- No migration of the old `selected` key.
- The milestone split between 1.0.0 and 1.1.0.
- Automatic scrub is off by default.
- Large-history handling moves to 1.1.0.
