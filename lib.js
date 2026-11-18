// @ts-check
// Shared helpers for Site Scrub. Imported as an ES module by both the service
// worker and the options page.

// Pull a lowercase hostname out of a URL. Returns null for anything that is
// not a normal web page (chrome://, brave://, file://, extension pages, etc.)
// since those never show up as scrubbable history items.
/** @param {string | undefined} url @returns {string | null} */
export function hostnameFromUrl(url) {
  try {
    const u = new URL(/** @type {string} */ (url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // "example.com." is the same site as "example.com", so drop the trailing dot.
    return u.hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
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
