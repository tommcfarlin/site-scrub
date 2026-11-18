// @ts-check
// Optional removal of cookies, cached files, and site storage for the sites a
// scrub matched. Uses chrome.browsingData with an origins filter, which needs
// the optional "browsingData" permission. Chrome clears cookies for the whole
// registrable domain of each origin (parent-domain and sibling cookies too).

/** @typedef {import("./settings.js").Settings["alsoRemove"]} AlsoRemove */

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
 * Remove the active data types for the given hostnames. Makes no call when no
 * type is on, no hostname is given, or the permission is missing. Rejects if
 * chrome.browsingData.remove fails, so the caller can report it.
 * @param {string[]} hostnames
 * @param {AlsoRemove} types
 * @returns {Promise<void>}
 */
export async function removeSiteData(hostnames, types) {
  const dataToRemove = dataTypesFor(types);
  const origins = originsFor(hostnames);
  if (Object.keys(dataToRemove).length === 0 || origins.length === 0) return;
  if (!(await chrome.permissions.contains(PERMISSION))) return;
  await chrome.browsingData.remove({ origins: /** @type {[string, ...string[]]} */ (origins) }, dataToRemove);
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
