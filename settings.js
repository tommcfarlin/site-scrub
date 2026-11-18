// @ts-check
// Settings storage for Site Scrub: one chrome.storage.local key per setting.
// Stored values are untrusted, so every read and write goes through sanitize().

/**
 * @typedef {{
 *   domains: string[],
 *   kept: string[],
 *   alsoRemove: { cookies: boolean, cache: boolean, storage: boolean },
 *   updateCheck: boolean,
 *   latestVersion: string | null,
 *   dismissedVersion: string | null
 * }} Settings
 */

export const DEFAULT_DOMAINS = ["facebook.com", "reddit.com", "linkedin.com", "x.com", "twitter.com"];

const KEYS = ["domains", "kept", "alsoRemove", "updateCheck", "latestVersion", "dismissedVersion"];

/**
 * Trim, lowercase, drop empties and duplicates (first-seen order kept).
 * Non-string entries are dropped.
 * @param {unknown[]} list
 * @returns {string[]}
 */
function cleanHosts(list) {
  /** @type {Set<string>} */
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const host = item.trim().toLowerCase();
    if (host) seen.add(host);
  }
  return [...seen];
}

/**
 * @param {unknown} raw
 * @returns {Settings}
 */
export function sanitize(raw) {
  const r = raw !== null && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const also = r.alsoRemove !== null && typeof r.alsoRemove === "object"
    ? /** @type {Record<string, unknown>} */ (r.alsoRemove)
    : {};
  return {
    // Default only when the key is absent or malformed; [] means "no sites".
    domains: Array.isArray(r.domains) ? cleanHosts(r.domains) : [...DEFAULT_DOMAINS],
    kept: Array.isArray(r.kept) ? cleanHosts(r.kept) : [],
    alsoRemove: {
      cookies: also.cookies === true,
      cache: also.cache === true,
      storage: also.storage === true,
    },
    updateCheck: typeof r.updateCheck === "boolean" ? r.updateCheck : true,
    latestVersion: typeof r.latestVersion === "string" ? r.latestVersion : null,
    dismissedVersion: typeof r.dismissedVersion === "string" ? r.dismissedVersion : null,
  };
}

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  const stored = await chrome.storage.local.get(KEYS);
  return sanitize(stored);
}

/**
 * Writes only the keys present in the patch, each as its sanitized value.
 * @param {Partial<Settings>} patch
 * @returns {Promise<void>}
 */
export async function saveSettings(patch) {
  const clean = /** @type {Record<string, unknown>} */ (sanitize(patch));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of KEYS) {
    if (Object.hasOwn(patch, key)) out[key] = clean[key];
  }
  if (Object.keys(out).length === 0) return;
  await chrome.storage.local.set(out);
}
