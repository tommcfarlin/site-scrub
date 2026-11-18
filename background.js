// Site Scrub service worker: handles the toolbar click, confirms, deletes, and
// triggers the 🧽 indicator. Injected page UI lives in injected-ui.js.

import {
  hostnameFromUrl,
  searchAllHistory,
  collectMatches,
  isPreChecked,
} from "./lib.js";
import { dialogInPage, spongeSplashInPage } from "./injected-ui.js";

const ICON = "icons/icon128.png";

// storage.session key holding purges awaiting a notification-button decision,
// as { [notificationId]: hostnames[] }. Persisted (not in-memory) so the
// decision survives service-worker eviction while the notification is open.
const PENDING_KEY = "pendingPurge";

// ---- dialog definitions --------------------------------------------------

function confirmOpts(count, sites) {
  return {
    title: "🧽 Scrub history?",
    message: `Permanently remove ${count} item${count === 1 ? "" : "s"} from ${sites} site${sites === 1 ? "" : "s"}.`,
    dismissValue: false,
    autofocusIndex: 0, // Cancel — confirming an irreversible action is opt-in
    buttons: [
      { label: "Cancel", value: false },
      { label: "Scrub", value: true, destructive: true, requireTrusted: true },
    ],
  };
}

function infoOpts(message) {
  return {
    title: "🧽 Site Scrub",
    message,
    dismissValue: true,
    autofocusIndex: 0,
    buttons: [{ label: "OK", value: true, primary: true }],
  };
}

// ---- selection ----------------------------------------------------------

// The hostnames the user has chosen to purge. If they have never opened the
// options page, fall back to the pre-checked defaults derived from the history
// items already fetched by the caller (no extra scan). Stored values are
// treated as untrusted: only strings survive the read.
async function getSelectedHostnames(items) {
  const { selected } = await chrome.storage.local.get("selected");
  if (Array.isArray(selected)) {
    return new Set(selected.filter((h) => typeof h === "string"));
  }

  const defaults = new Set();
  for (const item of items) {
    const host = hostnameFromUrl(item.url);
    if (host && isPreChecked(host)) defaults.add(host);
  }
  return defaults;
}

// ---- injection helper ----------------------------------------------------

// Try to run a function in the active tab. Returns { ok, result }. Injection
// fails on internal pages (brave://, chrome://, the Web Store, PDF viewer),
// which is expected — callers fall back to a notification.
async function tryInject(tabId, func, args = []) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return { ok: true, result: res?.result };
  } catch {
    return { ok: false, result: undefined };
  }
}

// ---- notifications -------------------------------------------------------

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: ICON, title, message });
}

// Create the fallback confirm notification and record the pending purge in
// session storage. The decision is handled by the top-level listeners below,
// so it survives a service-worker restart while the notification is open.
async function requestNotificationConfirm(hostnames, count, sites) {
  const id = await new Promise((res) =>
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: ICON,
        title: "🧽 Scrub history?",
        message: `Permanently remove ${count} item${count === 1 ? "" : "s"} from ${sites} site${sites === 1 ? "" : "s"}.`,
        buttons: [{ title: "Scrub" }, { title: "Cancel" }],
        requireInteraction: true,
      },
      res
    )
  );

  const { [PENDING_KEY]: store = {} } = await chrome.storage.session.get(PENDING_KEY);
  store[id] = hostnames;
  await chrome.storage.session.set({ [PENDING_KEY]: store });
}

async function takePending(id) {
  const { [PENDING_KEY]: store = {} } = await chrome.storage.session.get(PENDING_KEY);
  if (!(id in store)) return undefined;
  const hostnames = store[id];
  delete store[id];
  await chrome.storage.session.set({ [PENDING_KEY]: store });
  return hostnames;
}

// ---- purge ---------------------------------------------------------------

// Delete URLs in bounded batches so a large purge doesn't fire thousands of
// history-DB writes at once. Returns the number actually removed.
async function deleteInChunks(urls, size = 200) {
  let removed = 0;
  for (let i = 0; i < urls.length; i += size) {
    const batch = urls.slice(i, i + size);
    const results = await Promise.allSettled(
      batch.map((url) => chrome.history.deleteUrl({ url }))
    );
    removed += results.filter((r) => r.status === "fulfilled").length;
  }
  return removed;
}

// Delete every given URL, tolerating individual failures, then show the
// indicator (sponge overlay when a tab is injectable, else a notification)
// reporting the number actually removed. `sites` is passed in by the caller,
// which already parsed the hostnames.
async function performPurge(urls, sites, tabId) {
  const removed = await deleteInChunks(urls);
  const failed = urls.length - removed;
  const tail = failed ? ` (${failed} could not be removed)` : "";
  const message = `Removed ${removed} item${removed === 1 ? "" : "s"} from ${sites} site${sites === 1 ? "" : "s"}.${tail}`;

  // Sponge overlay (with a live-region announcement) when a tab is injectable,
  // else a system notification.
  let splashed = false;
  if (tabId != null) splashed = (await tryInject(tabId, spongeSplashInPage, [message])).ok;
  if (!splashed) notify("🧽 Scrubbed", message);
}

// ---- top-level notification handlers (durable across worker restarts) -----

chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
  try {
    const hostnames = await takePending(id);
    if (hostnames === undefined) return;
    chrome.notifications.clear(id);
    if (buttonIndex !== 0) return; // 0 = Scrub, 1 = Cancel

    const matches = collectMatches(await searchAllHistory(), new Set(hostnames));
    if (matches.length === 0) return;
    const sites = new Set(matches.map((m) => m.host)).size;
    await performPurge(matches.map((m) => m.url), sites, null); // internal page → notification
  } catch (e) {
    console.error("Site Scrub: notification purge failed", e);
    notify("🧽 Site Scrub", "Something went wrong completing the scrub.");
  }
});

chrome.notifications.onClosed.addListener((id) => {
  takePending(id); // drop any pending record; dismissal = cancel
});

// ---- main flow -----------------------------------------------------------

// Guard against a second toolbar click while one purge flow is mid-confirm,
// which would otherwise stack dialogs on the shared node ID. Module-scope is
// fine: the worst case (worker eviction resetting it) just re-allows a click.
let busy = false;

async function handleClick(tab) {
  const items = await searchAllHistory(); // single scan, reused below
  const selected = await getSelectedHostnames(items);

  if (selected.size === 0) {
    notify("🧽 Site Scrub", "No sites selected yet. Opening settings…");
    chrome.runtime.openOptionsPage();
    return;
  }

  const matches = collectMatches(items, selected);
  if (matches.length === 0) {
    const msg = "You have no sites to scrub.";
    let shown = false;
    if (tab?.id != null) shown = (await tryInject(tab.id, dialogInPage, [infoOpts(msg)])).ok;
    if (!shown) notify("🧽 Site Scrub", msg);
    return;
  }

  const urls = matches.map((m) => m.url);
  const sites = new Set(matches.map((m) => m.host)).size;

  // Prefer an in-page confirm. If it can be injected, it is authoritative for
  // this click (confirmed or cancelled) and we are done.
  if (tab?.id != null) {
    const inj = await tryInject(tab.id, dialogInPage, [confirmOpts(urls.length, sites)]);
    if (inj.ok) {
      if (inj.result === true) await performPurge(urls, sites, tab.id);
      return;
    }
  }

  // Fallback for internal pages: a notification confirm resolved by the
  // durable top-level handlers.
  await requestNotificationConfirm([...selected], urls.length, sites);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (busy) return;
  busy = true;
  try {
    await handleClick(tab);
  } catch (e) {
    console.error("Site Scrub: scrub failed", e);
    notify("🧽 Site Scrub", "Couldn't read or clear your history. Please try again.");
  } finally {
    busy = false;
  }
});
