// @ts-check
// Site Scrub settings page: reads history once, groups it by registrable
// domain, and lets the user pick domains to scrub and subdomains to Keep.
// Choices persist through settings.js (debounced, flushed on pagehide).

import { searchAllHistory } from "./lib.js";
import { groupByDomain } from "./match.js";
import { loadSettings, saveSettings } from "./settings.js";
import { domainView, summaryText, matchesQuery, isKept, itemsLabel, showUpdateBanner } from "./options-model.js";
import { ensurePermission } from "./site-data.js";

/** @typedef {import("./match.js").DomainGroup} DomainGroup */
/** @typedef {import("./settings.js").Settings["alsoRemove"]} AlsoRemove */

const listEl = /** @type {HTMLUListElement} */ (document.getElementById("list"));
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
const summaryEl = /** @type {HTMLElement} */ (document.getElementById("summary"));
const searchEl = /** @type {HTMLInputElement} */ (document.getElementById("search"));
const versionEl = /** @type {HTMLElement} */ (document.getElementById("version"));
const advancedToggle = /** @type {HTMLButtonElement} */ (document.getElementById("advanced-toggle"));
const advancedEl = /** @type {HTMLElement} */ (document.getElementById("advanced"));
const alsoSwitches = /** @type {NodeListOf<HTMLInputElement>} */ (advancedEl.querySelectorAll("input[data-type]"));

const bannerEl = /** @type {HTMLElement} */ (document.getElementById("update-banner"));
const bannerTitleEl = /** @type {HTMLElement} */ (document.getElementById("update-title"));
const laterEl = /** @type {HTMLButtonElement} */ (document.getElementById("update-later"));
const updateCheckEl = /** @type {HTMLInputElement} */ (document.getElementById("update-check"));

const SVG_NS = "http://www.w3.org/2000/svg";

/** @type {DomainGroup[]} */
let groups = [];
/** @type {Map<string, DomainGroup>} */
let byDomain = new Map();
/** @type {Set<string>} Registrable domains to scrub. */
let domains = new Set();
/** @type {Set<string>} Hostnames protected by Keep. */
let kept = new Set();
/** @type {AlsoRemove} Data types removed along with history. */
let alsoRemove = { cookies: false, cache: false, storage: false };

/** @type {Partial<import("./settings.js").Settings>} Writes waiting for the debounce. */
let pending = {};
/** @type {ReturnType<typeof setTimeout> | null} */
let saveTimer = null;

async function flush() {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = null;
  const patch = pending;
  pending = {};
  if (Object.keys(patch).length) await saveSettings(patch);
}

/** Coalesce rapid toggles into one write. @param {Partial<import("./settings.js").Settings>} patch */
function scheduleSave(patch) {
  Object.assign(pending, patch);
  clearTimeout(saveTimer ?? undefined);
  saveTimer = setTimeout(flush, 250);
}

// Flush any pending write if the page is closing.
window.addEventListener("pagehide", () => {
  if (saveTimer) flush();
});

/** @param {string} text @param {"status" | "alert"} [role] */
function showStatus(text, role = "status") {
  statusEl.setAttribute("role", role);
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
}

/** Right-pointing chevron; CSS turns it down when the row is open. @returns {SVGSVGElement} */
function chevronIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({
    width: "10", height: "16", viewBox: "0 0 10 16", fill: "none", stroke: "currentColor",
    "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M2 3l5 5-5 5");
  svg.append(path);
  return svg;
}

/** @param {string} cls @param {string} text */
function div(cls, text) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  return el;
}

/** @param {string} label @param {boolean} checked @param {boolean} [small] */
function makeSwitch(label, checked, small = false) {
  const sw = document.createElement("input");
  sw.type = "checkbox";
  sw.className = small ? "sw sm" : "sw";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  sw.checked = checked;
  return sw;
}

function updateSummary() {
  summaryEl.textContent = summaryText(groups, domains, kept);
}

/**
 * Refresh the parts of a domain row that depend on Keep: the count, the
 * detail line, and each subdomain's "protected" note.
 * @param {HTMLLIElement} li
 * @param {DomainGroup} group
 */
function refreshRow(li, group) {
  const view = domainView(group, kept);
  /** @type {HTMLElement} */ (li.querySelector(":scope > .row .num")).textContent = itemsLabel(view.count);
  /** @type {HTMLElement} */ (li.querySelector(":scope > .row .s")).textContent = view.detail;
  for (const sub of group.subdomains) {
    const s = li.querySelector(`.row.sub[data-host="${CSS.escape(sub.hostname)}"] .s`);
    if (s) s.textContent = itemsLabel(sub.count) + (isKept(sub.hostname, kept) ? " · protected" : "");
  }
}

/**
 * @param {DomainGroup} group
 * @returns {HTMLLIElement}
 */
function renderDomain(group) {
  const li = document.createElement("li");
  li.dataset.item = group.domain;

  const row = document.createElement("div");
  row.className = "row";
  row.dataset.domain = group.domain;

  const grow = document.createElement("div");
  grow.className = "grow";
  grow.append(div("t", group.domain), div("s", ""));

  const num = document.createElement("span");
  num.className = "num";

  const sw = makeSwitch(`Scrub ${group.domain}`, domains.has(group.domain));
  sw.addEventListener("change", () => {
    if (sw.checked) domains.add(group.domain);
    else domains.delete(group.domain);
    scheduleSave({ domains: [...domains] });
    updateSummary();
  });

  row.append(grow, num, sw);
  li.append(row);

  if (group.subdomains.length === 0) {
    const spacer = document.createElement("span");
    spacer.className = "chev";
    spacer.setAttribute("aria-hidden", "true");
    row.append(spacer);
  } else {
    const subs = document.createElement("ul");
    subs.className = "subs";
    subs.id = `subs-${group.domain}`;
    subs.hidden = true;

    for (const sub of group.subdomains) {
      const subLi = document.createElement("li");
      subLi.className = "row sub";
      subLi.dataset.host = sub.hostname;

      const subGrow = document.createElement("div");
      subGrow.className = "grow";
      subGrow.append(div("t", sub.hostname), div("s", ""));

      const keepLabel = document.createElement("label");
      keepLabel.className = "keep";
      const keepSw = makeSwitch(`Keep ${sub.hostname}`, kept.has(sub.hostname), true);
      keepSw.addEventListener("change", () => {
        if (keepSw.checked) kept.add(sub.hostname);
        else kept.delete(sub.hostname);
        scheduleSave({ kept: [...kept] });
        refreshRow(li, group);
        updateSummary();
      });
      keepLabel.append("Keep", keepSw);

      subLi.append(subGrow, keepLabel);
      subs.append(subLi);
    }

    const chev = document.createElement("button");
    chev.type = "button";
    chev.className = "chev";
    chev.setAttribute("aria-controls", subs.id);
    const setExpanded = (/** @type {boolean} */ open) => {
      chev.setAttribute("aria-expanded", String(open));
      chev.setAttribute("aria-label", `${open ? "Hide" : "Show"} subdomains of ${group.domain}`);
      subs.hidden = !open;
    };
    setExpanded(false);
    chev.addEventListener("click", () => setExpanded(chev.getAttribute("aria-expanded") !== "true"));
    chev.append(chevronIcon());
    row.append(chev);
    li.append(subs);
  }

  refreshRow(li, group);
  return li;
}

function render() {
  listEl.textContent = "";
  if (groups.length === 0) {
    showStatus("No browsing history found.");
    updateSummary();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const g of groups) frag.append(renderDomain(g));
  listEl.append(frag);
  applySearch();
  updateSummary();
}

function applySearch() {
  if (groups.length === 0) return;
  const q = searchEl.value;
  let shown = 0;
  for (const li of /** @type {NodeListOf<HTMLLIElement>} */ (listEl.querySelectorAll(":scope > li"))) {
    const group = byDomain.get(li.dataset.item ?? "");
    const match = !!group && matchesQuery(group, q);
    li.hidden = !match;
    if (match) shown++;
  }
  if (shown === 0) showStatus(`No sites match “${q.trim()}”.`);
  else hideStatus();
}

searchEl.addEventListener("input", applySearch);

// ---- Advanced ------------------------------------------------------------

/** @param {boolean} open */
function setAdvancedOpen(open) {
  advancedToggle.setAttribute("aria-expanded", String(open));
  advancedToggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} Advanced settings`);
  advancedEl.hidden = !open;
}
advancedToggle.addEventListener("click", () =>
  setAdvancedOpen(advancedToggle.getAttribute("aria-expanded") !== "true")
);

function renderAlsoRemove() {
  for (const sw of alsoSwitches) {
    sw.checked = alsoRemove[/** @type {keyof AlsoRemove} */ (sw.dataset.type)];
  }
}

for (const sw of alsoSwitches) {
  const type = /** @type {keyof AlsoRemove} */ (sw.dataset.type);
  sw.addEventListener("change", async () => {
    // Ask first, while the click still counts as a user gesture. If the user
    // says no, put the switch back and save nothing.
    if (sw.checked && !(await ensurePermission())) {
      sw.checked = false;
      return;
    }
    alsoRemove = { ...alsoRemove, [type]: sw.checked };
    // Save alsoRemove whole: a partial object would reset the other flags.
    await saveSettings({ alsoRemove: { ...alsoRemove } });
  });
}

// ---- Updates -------------------------------------------------------------

const currentVersion = chrome.runtime.getManifest().version;
let updateCheck = true;
/** @type {string | null} */
let latestVersion = null;
/** @type {string | null} */
let dismissedVersion = null;

function renderBanner() {
  const show = showUpdateBanner({ updateCheck, latestVersion, dismissedVersion }, currentVersion);
  bannerTitleEl.textContent = show ? `Version ${latestVersion} is available` : "";
  bannerEl.hidden = !show;
}

laterEl.addEventListener("click", () => {
  dismissedVersion = latestVersion;
  scheduleSave({ dismissedVersion });
  renderBanner();
});

updateCheckEl.addEventListener("change", () => {
  updateCheck = updateCheckEl.checked;
  scheduleSave({ updateCheck });
  renderBanner();
});

// Keep the banner current while the page is open (a daily check can land now).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("latestVersion" in changes) {
    const v = changes.latestVersion.newValue;
    latestVersion = typeof v === "string" ? v : null;
  }
  if ("dismissedVersion" in changes) {
    const v = changes.dismissedVersion.newValue;
    dismissedVersion = typeof v === "string" ? v : null;
  }
  if ("latestVersion" in changes || "dismissedVersion" in changes) renderBanner();
});

versionEl.textContent = `Site Scrub ${currentVersion}`;

// Initial load.
try {
  const [items, settings] = await Promise.all([searchAllHistory(), loadSettings()]);
  groups = groupByDomain(items);
  byDomain = new Map(groups.map((g) => [g.domain, g]));
  domains = new Set(settings.domains);
  kept = new Set(settings.kept);
  alsoRemove = settings.alsoRemove;
  updateCheck = settings.updateCheck;
  latestVersion = settings.latestVersion;
  dismissedVersion = settings.dismissedVersion;
  updateCheckEl.checked = updateCheck;
  renderBanner();
  renderAlsoRemove();
  render();
} catch (e) {
  console.error("Site Scrub: could not load history or settings", e);
  listEl.textContent = "";
  showStatus("Couldn't read your history. Try reopening this page.", "alert");
}
