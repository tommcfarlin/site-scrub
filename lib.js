// @ts-check
// Shared helpers for Site Scrub. Imported as an ES module by both the service
// worker and the options page.

// Registrable domains that get pre-checked on first load. Any hostname that
// belongs to one of these (the domain itself or any subdomain) is selected
// by default.
export const TARGET_DOMAINS = [
  "facebook.com",
  "reddit.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
];

// Pull a lowercase hostname out of a URL. Returns null for anything that is
// not a normal web page (chrome://, brave://, file://, extension pages, etc.)
// since those never show up as scrubbable history items.
/** @param {string | undefined} url @returns {string | null} */
export function hostnameFromUrl(url) {
  try {
    const u = new URL(/** @type {string} */ (url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

// True when a hostname is (or is a subdomain of) one of the target domains.
/** @param {string} hostname @returns {boolean} */
export function isPreChecked(hostname) {
  return TARGET_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith("." + d)
  );
}

// Read the entire available history in a single call. Callers derive both
// per-hostname tallies and matching URLs from this one result set rather than
// searching repeatedly.
/** @returns {Promise<chrome.history.HistoryItem[]>} */
export async function searchAllHistory() {
  return chrome.history.search({
    text: "",
    startTime: 0, // from the epoch = everything the browser still retains
    maxResults: 1000000,
  });
}

// Tally distinct URLs per hostname from an already-fetched history result.
// Returns an array of { hostname, count } sorted alphabetically by hostname.
/**
 * @param {{ url?: string }[]} items
 * @returns {{ hostname: string, count: number }[]}
 */
export function tallyByHostname(items) {
  const counts = new Map();
  for (const item of items) {
    const host = hostnameFromUrl(item.url);
    if (!host) continue;
    counts.set(host, (counts.get(host) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([hostname, count]) => ({ hostname, count }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}

// From an already-fetched history result, collect { url, host } pairs whose
// hostname is in the selected set. Returning the parsed host avoids re-parsing
// the same URLs downstream.
/**
 * @param {{ url?: string }[]} items
 * @param {Set<string>} selectedSet
 * @returns {{ url: string, host: string }[]}
 */
export function collectMatches(items, selectedSet) {
  const matches = [];
  for (const item of items) {
    const host = hostnameFromUrl(item.url);
    if (host && selectedSet.has(host)) matches.push({ url: /** @type {string} */ (item.url), host });
  }
  return matches;
}

// Convenience for the options page: one scan, tallied.
/** @returns {Promise<{ hostname: string, count: number }[]>} */
export async function scanHistory() {
  return tallyByHostname(await searchAllHistory());
}
