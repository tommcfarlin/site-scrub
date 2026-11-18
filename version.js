// @ts-check
// Version parsing and comparison for the update check. Pure: no chrome.* use.

/**
 * Reads a strict "major.minor.patch" string. Anything else is null.
 * @param {string} text
 * @returns {[number, number, number] | null}
 */
export function parseVersion(text) {
  if (typeof text !== "string") return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two version strings. Returns 0 when either one is invalid.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}
