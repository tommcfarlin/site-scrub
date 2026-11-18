// @ts-check
// Pure view logic for the settings page: counts after Keep, detail and summary
// text, and search matching. No DOM or chrome.* use, so it runs under node --test.

/** @typedef {import("./match.js").DomainGroup} DomainGroup */

import { compareVersions, parseVersion } from "./version.js";

/**
 * True when a Keep entry covers this host (the entry itself or any subdomain
 * of it). Same rule as isScrubbed in match.js.
 * @param {string} hostname
 * @param {Set<string>} kept
 * @returns {boolean}
 */
export function isKept(hostname, kept) {
  for (const k of kept) {
    if (hostname === k || hostname.endsWith("." + k)) return true;
  }
  return false;
}

/** @param {number} n @returns {string} */
export function itemsLabel(n) {
  return `${n} item${n === 1 ? "" : "s"}`;
}

/**
 * What a domain row shows: the number of items that will be removed (Keep
 * items excluded), how many subdomains are kept, and the detail line.
 * @param {DomainGroup} group
 * @param {Set<string>} kept
 * @returns {{ count: number, keptCount: number, detail: string }}
 */
export function domainView(group, kept) {
  const subTotal = group.subdomains.reduce((n, s) => n + s.count, 0);
  const apexCount = group.count - subTotal;
  let count = isKept(group.domain, kept) ? 0 : apexCount;
  let keptCount = 0;
  for (const s of group.subdomains) {
    if (isKept(s.hostname, kept)) keptCount++;
    else count += s.count;
  }
  const n = group.subdomains.length;
  let detail = n === 0 ? "No subdomains" : `${n} subdomain${n === 1 ? "" : "s"}`;
  if (keptCount > 0) detail += ` · ${keptCount} kept`;
  return { count, keptCount, detail };
}

/**
 * "N sites · M items" over the ticked domains that appear in history.
 * @param {DomainGroup[]} groups
 * @param {Set<string>} domains
 * @param {Set<string>} kept
 * @returns {string}
 */
export function summaryText(groups, domains, kept) {
  let sites = 0;
  let items = 0;
  for (const g of groups) {
    if (!domains.has(g.domain)) continue;
    sites++;
    items += domainView(g, kept).count;
  }
  return `${sites} site${sites === 1 ? "" : "s"} · ${itemsLabel(items)}`;
}

/**
 * Case-insensitive substring match on the domain or any of its subdomains.
 * An empty query matches everything.
 * @param {DomainGroup} group
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(group, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return group.domain.includes(q) || group.subdomains.some((s) => s.hostname.includes(q));
}

/**
 * Whether the update banner shows: updates are on, a newer version than the
 * running one is stored, and the user has not pressed Later for it (or for a
 * newer one).
 * @param {{ updateCheck: boolean, latestVersion: string | null, dismissedVersion: string | null }} s
 * @param {string} currentVersion
 * @returns {boolean}
 */
export function showUpdateBanner(s, currentVersion) {
  if (!s.updateCheck || s.latestVersion === null) return false;
  if (compareVersions(s.latestVersion, currentVersion) !== 1) return false;
  if (s.dismissedVersion !== null && parseVersion(s.dismissedVersion) !== null &&
      compareVersions(s.latestVersion, s.dismissedVersion) !== 1) return false;
  return true;
}
