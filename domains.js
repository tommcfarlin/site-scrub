// @ts-check
// Find the registrable domain (public suffix plus one label) of a hostname,
// using the public suffix list in psl-data.js.
import { RULES } from "./psl-data.js";

const EXACT = new Set(RULES.exact);
const WILDCARD = new Set(RULES.wildcard);
const EXCEPTION = new Set(RULES.exception);

// Returns null for IP literals, single labels, hosts that are themselves a
// public suffix, and hosts that end in a dot. Expects a lowercase hostname.
/** @param {string} hostname @returns {string | null} */
export function registrableDomain(hostname) {
  if (!hostname || hostname.endsWith(".")) return null;
  if (hostname.startsWith("[") || hostname.includes(":")) return null;
  if (/^\d+(\.\d+){3}$/.test(hostname)) return null;
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) return null;

  // Number of labels in the public suffix. The default rule is "*" (1 label).
  let suffixLen = 1;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join(".");
    const n = labels.length - i;
    if (EXCEPTION.has(candidate)) {
      // An exception rule wins: the suffix is the rule minus its first label.
      suffixLen = n - 1;
      break;
    }
    if (EXACT.has(candidate) && n > suffixLen) suffixLen = n;
    // Wildcard "*.parent" matches one extra label in front of parent.
    const parent = labels.slice(i + 1).join(".");
    if (i + 1 < labels.length && WILDCARD.has(parent) && n > suffixLen) suffixLen = n;
  }
  if (labels.length <= suffixLen) return null;
  return labels.slice(labels.length - suffixLen - 1).join(".");
}
