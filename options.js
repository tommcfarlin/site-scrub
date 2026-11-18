// @ts-check
// Site Scrub settings screen: combs history, lists hostnames alphabetically, and
// persists the user's selection to chrome.storage.local.

import { scanHistory, isPreChecked } from "./lib.js";

const listEl = /** @type {HTMLElement} */ (document.getElementById("list"));
const summaryEl = /** @type {HTMLElement} */ (document.getElementById("summary"));

/** @type {{ hostname: string, count: number }[]} */
let scan = [];
/** @type {Set<string>} Hostnames the user wants purged. */
let selected = new Set();
/** @type {ReturnType<typeof setTimeout> | null} Pending debounced write, if any. */
let saveTimer = null;

async function loadSelection() {
  const { selected: saved } = await chrome.storage.local.get("selected");
  if (Array.isArray(saved)) {
    selected = new Set(saved.filter((h) => typeof h === "string"));
    return;
  }
  // First ever open: pre-check the target domains and persist that default.
  selected = new Set(scan.filter((e) => isPreChecked(e.hostname)).map((e) => e.hostname));
  await save();
}

async function save() {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = null;
  await chrome.storage.local.set({ selected: [...selected] });
}

// Coalesce rapid checkbox toggles into a single write.
function scheduleSave() {
  clearTimeout(saveTimer ?? undefined);
  saveTimer = setTimeout(save, 250);
}

// Flush any pending write if the page is closing.
window.addEventListener("pagehide", () => {
  if (saveTimer) save();
});

function updateSummary() {
  const sites = scan.filter((e) => selected.has(e.hostname));
  const items = sites.reduce((n, e) => n + e.count, 0);
  summaryEl.textContent = `${sites.length} site${sites.length === 1 ? "" : "s"} · ~${items} item${items === 1 ? "" : "s"}`;
}

function render() {
  listEl.textContent = "";

  if (scan.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.setAttribute("role", "status");
    empty.textContent = "No browsing history found.";
    listEl.append(empty);
    updateSummary();
    return;
  }

  const frag = document.createDocumentFragment();
  for (const { hostname, count } of scan) {
    const row = document.createElement("label");
    row.className = "row";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(hostname);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(hostname);
      else selected.delete(hostname);
      scheduleSave();
      updateSummary();
    });

    const host = document.createElement("span");
    host.className = "host";
    host.textContent = hostname;

    const badge = document.createElement("span");
    badge.className = "count";
    badge.textContent = String(count);
    badge.setAttribute("aria-label", `${count} item${count === 1 ? "" : "s"}`);

    row.append(cb, host, badge);
    frag.append(row);
  }
  listEl.append(frag);

  updateSummary();
}

function showError() {
  listEl.textContent = "";
  const err = document.createElement("div");
  err.className = "empty";
  err.setAttribute("role", "alert");
  err.textContent = "Couldn't read your history. Try reopening this page.";
  listEl.append(err);
}

async function rescan() {
  listEl.innerHTML = '<div class="loading" role="status">Combing your history…</div>';
  try {
    scan = await scanHistory();
    render();
  } catch (e) {
    console.error("Site Scrub: history scan failed", e);
    showError();
  }
}

/** @type {HTMLElement} */ (document.getElementById("rescan")).addEventListener("click", rescan);

/** @type {HTMLElement} */ (document.getElementById("all")).addEventListener("click", async () => {
  selected = new Set(scan.map((e) => e.hostname));
  await save();
  render();
});

/** @type {HTMLElement} */ (document.getElementById("none")).addEventListener("click", async () => {
  selected = new Set();
  await save();
  render();
});

// Initial load.
try {
  scan = await scanHistory();
  await loadSelection();
  render();
} catch (e) {
  console.error("Site Scrub: initial load failed", e);
  showError();
}
