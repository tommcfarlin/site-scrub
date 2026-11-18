// @ts-check
// Optional removal of cookies, cached files, and site storage for the sites a
// scrub matched. Uses chrome.browsingData with an origins filter, which needs
// the optional "browsingData" permission. Chrome clears cookies for the whole
// registrable domain of each origin (parent-domain and sibling cookies too),
// so planSiteData leaves cookies alone for a domain with a kept subdomain.

import { registrableDomain } from "./domains.js";

/** @typedef {import("./settings.js").Settings["alsoRemove"]} AlsoRemove */
/**
 * @typedef {{
 *   hosts: string[],
 *   cookieHosts: string[],
 *   types: AlsoRemove,
 *   skipped: AlsoRemove,
 *   keptCookieSites: number
 * }} SiteDataPlan
 */

/** @returns {AlsoRemove} */
const none = () => ({ cookies: false, cache: false, storage: false });

/** @type {chrome.permissions.Permissions} */
const PERMISSION = { permissions: ["browsingData"] };

/**
 * The https and http origin of each hostname, de-duplicated, first-seen order.
 * @param {string[]} hostnames
 * @returns {string[]}
 */
export function originsFor(hostnames) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const host of hostnames) {
    out.add(`https://${host}`);
    out.add(`http://${host}`);
  }
  return [...out];
}

/**
 * Ask for the optional browsingData permission. Must run inside a user
 * gesture (a click handler). Resolves false when denied or when it fails.
 * @returns {Promise<boolean>}
 */
export async function ensurePermission() {
  try {
    return (await chrome.permissions.request(PERMISSION)) === true;
  } catch {
    return false;
  }
}

/**
 * True when the optional browsingData permission is granted now.
 * @returns {Promise<boolean>}
 */
export async function hasPermission() {
  try {
    return (await chrome.permissions.contains(PERMISSION)) === true;
  } catch {
    return false;
  }
}

/**
 * The number of sites among the given hostnames: unique registrable domains,
 * so facebook.com and m.facebook.com are one site. The same unit as the
 * settings page and the "Cookies are kept for N sites" note. Hostnames
 * without a registrable domain are skipped.
 * @param {string[]} hostnames
 * @returns {number}
 */
export function countSites(hostnames) {
  return new Set(hostnames.map((h) => registrableDomain(h)).filter((d) => d !== null)).size;
}

/**
 * Decide what a scrub removes besides history. Pure: the caller passes
 * whether the permission is granted. Without it, nothing is removed and the
 * requested types are listed as skipped. Cookies are not removed for a
 * registrable domain that has a kept subdomain, because Chrome clears cookies
 * for the whole registrable domain (Keep always wins).
 * @param {string[]} hosts Unique matched hostnames.
 * @param {string[]} kept Kept hostnames from settings.
 * @param {AlsoRemove} requested Types turned on in settings.
 * @param {boolean} granted
 * @returns {SiteDataPlan}
 */
export function planSiteData(hosts, kept, requested, granted) {
  if (!granted) {
    return { hosts, cookieHosts: [], types: none(), skipped: { ...requested }, keptCookieSites: 0 };
  }
  /** @type {string[]} */
  let cookieHosts = [];
  let keptCookieSites = 0;
  if (requested.cookies) {
    const keptDomains = new Set(kept.map((k) => registrableDomain(k)).filter(Boolean));
    cookieHosts = hosts.filter((h) => !keptDomains.has(registrableDomain(h)));
    keptCookieSites = new Set(
      hosts.map((h) => registrableDomain(h)).filter((d) => d !== null && keptDomains.has(d))
    ).size;
  }
  return {
    hosts,
    cookieHosts,
    types: { ...requested, cookies: requested.cookies && cookieHosts.length > 0 },
    skipped: none(),
    keptCookieSites,
  };
}

/**
 * @param {AlsoRemove} types
 * @returns {chrome.browsingData.DataTypeSet}
 */
function dataTypesFor(types) {
  /** @type {chrome.browsingData.DataTypeSet} */
  const set = {};
  if (types.cookies) set.cookies = true;
  if (types.cache) set.cache = true;
  if (types.storage) {
    set.localStorage = true;
    set.indexedDB = true;
    set.serviceWorkers = true;
    set.cacheStorage = true;
  }
  return set;
}

/**
 * @param {string[]} hostnames
 * @param {chrome.browsingData.DataTypeSet} dataToRemove
 * @returns {Promise<boolean>} true when a call was made
 */
async function removeFor(hostnames, dataToRemove) {
  const origins = originsFor(hostnames);
  if (Object.keys(dataToRemove).length === 0 || origins.length === 0) return false;
  await chrome.browsingData.remove({ origins: /** @type {[string, ...string[]]} */ (origins) }, dataToRemove);
  return true;
}

/**
 * Remove the active data types for the given hostnames and report what was
 * removed. Cookies go only to `cookieHosts` (default: all hostnames). Makes no
 * call when no type is on, no hostname is given, or the permission is missing
 * (then every type is reported as not removed). Rejects if
 * chrome.browsingData.remove fails, so the caller can report it.
 * @param {string[]} hostnames
 * @param {AlsoRemove} types
 * @param {string[]} [cookieHosts]
 * @returns {Promise<{ removed: AlsoRemove }>}
 */
export async function removeSiteData(hostnames, types, cookieHosts = hostnames) {
  const removed = none();
  if (!types.cookies && !types.cache && !types.storage) return { removed };
  if (hostnames.length === 0 || !(await hasPermission())) return { removed };

  const cookieSet = new Set(cookieHosts);
  const sameHosts = cookieSet.size === new Set(hostnames).size && hostnames.every((h) => cookieSet.has(h));
  if (!types.cookies || sameHosts) {
    if (await removeFor(hostnames, dataTypesFor(types))) Object.assign(removed, types);
    return { removed };
  }
  if (await removeFor(cookieHosts, { cookies: true })) removed.cookies = true;
  const rest = { ...types, cookies: false };
  if (await removeFor(hostnames, dataTypesFor(rest))) {
    removed.cache = rest.cache;
    removed.storage = rest.storage;
  }
  return { removed };
}

/**
 * Join words as "a", "a and b", or "a, b, and c".
 * @param {string[]} parts
 * @returns {string}
 */
function joinList(parts) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * @param {AlsoRemove} types
 * @returns {string[]}
 */
function dataParts(types) {
  /** @type {string[]} */
  const parts = [];
  if (types.cookies) parts.push("cookies");
  if (types.cache) parts.push("cached files");
  if (types.storage) parts.push("site storage");
  return parts;
}

/**
 * The active data types in words, without history: "", "cookies",
 * "cookies and cached files", and so on.
 * @param {AlsoRemove} types
 * @returns {string}
 */
export function dataPhrase(types) {
  return joinList(dataParts(types));
}

/**
 * What a scrub removes, in words: "history", "history and cookies",
 * "history, cookies, and cached files", and so on.
 * @param {AlsoRemove} types
 * @returns {string}
 */
export function removalPhrase(types) {
  return joinList(["history", ...dataParts(types)]);
}
