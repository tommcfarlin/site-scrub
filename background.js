// @ts-check
// Site Scrub service worker: handles the toolbar click, confirms, deletes, and
// triggers the 🧽 indicator. Injected page UI lives in injected-ui.js.

import { searchAllHistory } from "./lib.js";
import { collectMatches } from "./match.js";
import { loadSettings, sanitize } from "./settings.js";
import { removeSiteData, planSiteData, hasPermission, removalPhrase, dataPhrase, countSites } from "./site-data.js";
import { handleUpdateAlarm, registerUpdateAlarm, syncBadge } from "./updates.js";
import { dialogInPage, spongeSplashInPage } from "./injected-ui.js";

const ICON = "icons/icon128.png";

// storage.session holds one key per open confirm notification,
// `pendingPurge:<notificationId>`, with what that confirm showed. Persisted (not
// in-memory) so the decision survives service-worker eviction while the
// notification is open. One key per id, so records never overwrite each other.
const PENDING_PREFIX = "pendingPurge:";

const CHANGED_MESSAGE = "Something changed while you were deciding. Click the sponge again to review.";
const NO_SITES_MESSAGE = "You have no sites to scrub.";

/** @typedef {import("./settings.js").Settings["alsoRemove"]} AlsoRemove */
/** @typedef {import("./site-data.js").SiteDataPlan} SiteDataPlan */
// What a confirm showed: the settings snapshot it was built from, the number
// of history items it named, and the data types it named.
/** @typedef {{ domains: string[], kept: string[], count: number, types: AlsoRemove }} Confirmed */

/** @param {string} id */
const pendingKey = (id) => `${PENDING_PREFIX}${id}`;

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** @param {string} text */
const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

// Extra sentences shared by the confirm and the result: data types skipped
// for lack of permission, and cookies kept for domains with a kept subdomain.
/**
 * @param {AlsoRemove} skipped
 * @param {number} keptCookieSites
 */
function dataNotes(skipped, keptCookieSites) {
  let out = "";
  const skippedText = dataPhrase(skipped);
  if (skippedText) out += ` ${capitalize(skippedText)} are skipped because the permission is off.`;
  if (keptCookieSites) out += ` Cookies are kept for ${plural(keptCookieSites, "site")} with a kept subdomain.`;
  return out;
}

// "Permanently remove history and cookies from 3 sites (12 history items)."
// Sites are registrable domains (countSites); the count in brackets is always
// the number of history items.
/**
 * @param {number} count
 * @param {SiteDataPlan} plan
 */
function confirmMessage(count, plan) {
  return `Permanently remove ${removalPhrase(plan.types)} from ${plural(countSites(plan.hosts), "site")} ` +
    `(${plural(count, "history item")}).${dataNotes(plan.skipped, plan.keptCookieSites)}`;
}

// Plan the site-data part of a scrub: unique matched hosts, the permission
// as it is now, and Keep. Used for both the confirm text and the removal.
/**
 * @param {{ url: string, host: string }[]} matches
 * @param {string[]} kept
 * @param {AlsoRemove} requested
 * @returns {Promise<SiteDataPlan>}
 */
async function planFor(matches, kept, requested) {
  const hosts = [...new Set(matches.map((m) => m.host))];
  const anyOn = requested.cookies || requested.cache || requested.storage;
  const granted = anyOn ? await hasPermission() : true;
  return planSiteData(hosts, kept, requested, granted);
}

// ---- dialog definitions --------------------------------------------------

/**
 * @param {number} count
 * @param {SiteDataPlan} plan
 * @returns {import("./injected-ui.js").DialogOptions}
 */
function confirmOpts(count, plan) {
  return {
    title: "🧽 Scrub history?",
    message: confirmMessage(count, plan),
    dismissValue: false,
    autofocusIndex: 0, // Cancel — confirming an irreversible action is opt-in
    buttons: [
      { label: "Cancel", value: false },
      { label: "Scrub", value: true, destructive: true, requireTrusted: true },
    ],
  };
}

/**
 * @param {string} message
 * @returns {import("./injected-ui.js").DialogOptions}
 */
function infoOpts(message) {
  return {
    title: "🧽 Site Scrub",
    message,
    dismissValue: true,
    autofocusIndex: 0,
    buttons: [{ label: "OK", value: true, primary: true }],
  };
}

// ---- injection helper ----------------------------------------------------

// Try to run a function in the active tab. Returns { ok, result }. Injection
// fails on internal pages (brave://, chrome://, the Web Store, PDF viewer),
// which is expected — callers fall back to a notification.
/**
 * @param {number} tabId
 * @param {(...args: any[]) => any} func
 * @param {any[]} [args]
 * @returns {Promise<{ ok: boolean, result: any }>}
 */
async function tryInject(tabId, func, args = []) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return { ok: true, result: res?.result };
  } catch {
    return { ok: false, result: undefined };
  }
}

// ---- notifications -------------------------------------------------------

/**
 * @param {string} title
 * @param {string} message
 */
function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: ICON, title, message });
}

// Create the fallback confirm notification. Its pending record is stored
// first, under the notification id chosen here, so a Scrub click that comes
// the moment the notification appears always finds it. The decision is handled
// by the top-level listeners below, so it survives a service-worker restart.
/**
 * @param {Confirmed} confirmed
 * @param {SiteDataPlan} plan
 */
async function requestNotificationConfirm(confirmed, plan) {
  const id = `site-scrub-${crypto.randomUUID()}`;
  const key = pendingKey(id);
  await chrome.storage.session.set({ [key]: confirmed });
  try {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: ICON,
      title: "🧽 Scrub history?",
      message: confirmMessage(confirmed.count, plan),
      buttons: [{ title: "Scrub" }, { title: "Cancel" }],
      requireInteraction: true,
    });
  } catch (e) {
    await chrome.storage.session.remove(key).catch(() => {});
    throw e;
  }
}

/**
 * Stored values are untrusted: rebuild a Confirmed record from one. A bad
 * count (0) can never equal a real match count, so it always aborts.
 * @param {unknown} raw
 * @returns {Confirmed}
 */
function readConfirmed(raw) {
  const r = raw !== null && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const clean = sanitize({
    domains: Array.isArray(r.domains) ? r.domains : [],
    kept: r.kept,
    alsoRemove: r.types,
  });
  const count = typeof r.count === "number" && Number.isInteger(r.count) && r.count > 0 ? r.count : 0;
  return { domains: clean.domains, kept: clean.kept, count, types: clean.alsoRemove };
}

// Ids whose record is being taken right now, so a double click on the same
// notification cannot run the scrub twice.
/** @type {Set<string>} */
const taking = new Set();

/** @param {string} id @returns {Promise<Confirmed | undefined>} */
async function takePending(id) {
  if (taking.has(id)) return undefined;
  taking.add(id);
  try {
    const key = pendingKey(id);
    const { [key]: raw } = await chrome.storage.session.get(key);
    if (raw === undefined) return undefined;
    await chrome.storage.session.remove(key);
    return readConfirmed(raw);
  } finally {
    taking.delete(id);
  }
}

// ---- after the confirm ---------------------------------------------------

/** @param {AlsoRemove} a @param {AlsoRemove} b */
const sameTypes = (a, b) => a.cookies === b.cookies && a.cache === b.cache && a.storage === b.storage;

// Build the scrub again after the user confirmed, from the history and the
// settings as they are now. Only domains that were confirmed AND are still on
// count, and Keep entries from both are honored, so nothing outside what was
// confirmed and what the settings now allow is ever matched. If the result is
// not what the confirm said (item count or data types), nothing is deleted.
/**
 * @param {Confirmed} confirmed
 * @returns {Promise<{ status: "none" } | { status: "changed" } | { status: "ok", matches: { url: string, host: string }[], plan: SiteDataPlan }>}
 */
async function recheck(confirmed) {
  const settings = await loadSettings();
  const current = new Set(settings.domains);
  const domains = new Set(confirmed.domains.filter((d) => current.has(d)));
  const kept = [...new Set([...confirmed.kept, ...settings.kept])];
  const matches = domains.size === 0 ? [] : collectMatches(await searchAllHistory(), domains, new Set(kept));
  if (matches.length === 0) return { status: "none" };
  const plan = await planFor(matches, kept, settings.alsoRemove);
  if (matches.length !== confirmed.count || !sameTypes(plan.types, confirmed.types)) return { status: "changed" };
  return { status: "ok", matches, plan };
}

// Run a confirmed scrub, or explain why nothing was deleted.
/**
 * @param {Confirmed} confirmed
 * @param {number | null} tabId
 */
async function scrubConfirmed(confirmed, tabId) {
  const result = await recheck(confirmed);
  if (result.status === "none") notify("🧽 Site Scrub", NO_SITES_MESSAGE);
  else if (result.status === "changed") notify("🧽 Site Scrub", CHANGED_MESSAGE);
  else await performPurge(result.matches, result.plan, tabId);
}

// ---- purge ---------------------------------------------------------------

// Delete URLs in bounded batches so a large purge doesn't fire thousands of
// history-DB writes at once. Returns the number actually removed.
/**
 * @param {string[]} urls
 * @param {number} [size]
 * @returns {Promise<number>}
 */
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

// Delete every given URL, tolerating individual failures, then remove the
// planned site data for the matched hostnames, then show the indicator
// (sponge overlay when a tab is injectable, else a notification). The plan is
// the re-checked one, which matches what the confirm described. The
// message names only what was actually removed and reports the number of
// history items removed. Skipped types and site-data failures add a sentence.
/**
 * @param {{ url: string, host: string }[]} matches
 * @param {SiteDataPlan} plan
 * @param {number | null} tabId
 */
async function performPurge(matches, plan, tabId) {
  const urls = matches.map((m) => m.url);
  const removed = await deleteInChunks(urls);
  const failed = urls.length - removed;

  /** @type {AlsoRemove} */
  let done = { cookies: false, cache: false, storage: false };
  let dataError = "";
  try {
    done = (await removeSiteData(plan.hosts, plan.types, plan.cookieHosts)).removed;
  } catch (e) {
    console.error("Site Scrub: removing site data failed", e);
    dataError = ` ${capitalize(dataPhrase(plan.types))} could not be removed.`;
  }
  // Planned types that were not removed without an error: the permission was
  // turned off after the confirm.
  /** @type {AlsoRemove} */
  const skipped = dataError ? plan.skipped : {
    cookies: plan.skipped.cookies || (plan.types.cookies && !done.cookies),
    cache: plan.skipped.cache || (plan.types.cache && !done.cache),
    storage: plan.skipped.storage || (plan.types.storage && !done.storage),
  };

  const tail = failed ? `, ${failed} could not be removed` : "";
  const message =
    `Removed ${removalPhrase(done)} from ${plural(countSites(plan.hosts), "site")} (${plural(removed, "history item")}${tail}).` +
    `${dataError}${dataNotes(skipped, plan.keptCookieSites)}`;

  // Sponge overlay (with a live-region announcement) when a tab is injectable,
  // else a system notification.
  let splashed = false;
  if (tabId != null) splashed = (await tryInject(tabId, spongeSplashInPage, [message])).ok;
  if (!splashed) notify("🧽 Scrubbed", message);
}

// ---- top-level notification handlers (durable across worker restarts) -----

chrome.notifications.onButtonClicked.addListener(async (id, buttonIndex) => {
  try {
    const confirmed = await takePending(id);
    if (confirmed === undefined) return;
    chrome.notifications.clear(id);
    if (buttonIndex !== 0) return; // 0 = Scrub, 1 = Cancel
    await scrubConfirmed(confirmed, null); // internal page → notification
  } catch (e) {
    console.error("Site Scrub: notification purge failed", e);
    notify("🧽 Site Scrub", "Something went wrong completing the scrub.");
  }
});

chrome.notifications.onClosed.addListener((id) => {
  // Drop only this notification's record; dismissal = cancel.
  chrome.storage.session.remove(pendingKey(id)).catch((e) =>
    console.error("Site Scrub: clearing a pending scrub failed", e)
  );
});

// ---- main flow -----------------------------------------------------------

// Guard against a second toolbar click while one purge flow is mid-confirm,
// which would otherwise stack dialogs on the shared node ID. Module-scope is
// fine: the worst case (worker eviction resetting it) just re-allows a click.
let busy = false;

/** @param {chrome.tabs.Tab} tab */
async function handleClick(tab) {
  const items = await searchAllHistory(); // one scan for the confirm
  const settings = await loadSettings();
  const domains = new Set(settings.domains);
  const kept = new Set(settings.kept);

  if (domains.size === 0) {
    notify("🧽 Site Scrub", "No sites to scrub yet. Opening settings…");
    chrome.runtime.openOptionsPage();
    return;
  }

  const matches = collectMatches(items, domains, kept);
  if (matches.length === 0) {
    const msg = "You have no sites to scrub.";
    let shown = false;
    if (tab?.id != null) shown = (await tryInject(tab.id, dialogInPage, [infoOpts(msg)])).ok;
    if (!shown) notify("🧽 Site Scrub", msg);
    return;
  }

  const plan = await planFor(matches, settings.kept, settings.alsoRemove);
  /** @type {Confirmed} */
  const confirmed = { domains: [...domains], kept: [...kept], count: matches.length, types: plan.types };

  // Prefer an in-page confirm. If it can be injected, it is authoritative for
  // this click (confirmed or cancelled) and we are done.
  if (tab?.id != null) {
    const inj = await tryInject(tab.id, dialogInPage, [confirmOpts(confirmed.count, plan)]);
    if (inj.ok) {
      if (inj.result === true) await scrubConfirmed(confirmed, tab.id);
      return;
    }
  }

  // Fallback for internal pages: a notification confirm resolved by the
  // durable top-level handlers.
  await requestNotificationConfirm(confirmed, plan);
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

// ---- update check (top-level so listeners survive worker restarts) --------

chrome.alarms.onAlarm.addListener((alarm) => {
  handleUpdateAlarm(alarm).catch((e) => console.error("Site Scrub: update check failed", e));
});

// Keep the badge in step with the settings (the switch, a new stored version).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("updateCheck" in changes || "latestVersion" in changes || "dismissedVersion" in changes)) return;
  syncBadge().catch((e) => console.error("Site Scrub: badge update failed", e));
});

/** Set up the daily alarm and refresh the badge (e.g. after installing a newer version). */
function startUpdates() {
  registerUpdateAlarm().catch((e) => console.error("Site Scrub: alarm setup failed", e));
  syncBadge().catch((e) => console.error("Site Scrub: badge update failed", e));
}

chrome.runtime.onInstalled.addListener(startUpdates);
chrome.runtime.onStartup.addListener(startUpdates);
