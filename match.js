// @ts-check
// Matching and grouping for Site Scrub: decides which history items belong to
// a scrubbed domain (honoring Keep entries) and groups items for the options UI.

import { registrableDomain } from "./domains.js";
import { hostnameFromUrl } from "./lib.js";

/**
 * @typedef {{ domain: string, count: number, subdomains: { hostname: string, count: number }[] }} DomainGroup
 */

/**
 * True when the hostname's registrable domain is scrubbed and no Keep entry
 * covers it (a kept host also keeps all of its subdomains).
 * @param {string} hostname
 * @param {Set<string>} domains
 * @param {Set<string>} kept
 * @returns {boolean}
 */
export function isScrubbed(hostname, domains, kept) {
  const domain = registrableDomain(hostname);
  if (!domain || !domains.has(domain)) return false;
  for (const k of kept) {
    if (hostname === k || hostname.endsWith("." + k)) return false;
  }
  return true;
}

/**
 * @param {{ url?: string }[]} items
 * @param {Set<string>} domains
 * @param {Set<string>} kept
 * @returns {{ url: string, host: string }[]}
 */
export function collectMatches(items, domains, kept) {
  /** @type {{ url: string, host: string }[]} */
  const out = [];
  for (const item of items) {
    const host = hostnameFromUrl(item.url);
    if (!host || !registrableDomain(host)) continue;
    if (isScrubbed(host, domains, kept)) {
      out.push({ url: /** @type {string} */ (item.url), host });
    }
  }
  return out;
}

/**
 * @param {{ url?: string }[]} items
 * @returns {DomainGroup[]}
 */
export function groupByDomain(items) {
  /** @type {Map<string, { count: number, hosts: Map<string, number> }>} */
  const groups = new Map();
  for (const item of items) {
    const host = hostnameFromUrl(item.url);
    if (!host) continue;
    const domain = registrableDomain(host);
    if (!domain) continue;
    let g = groups.get(domain);
    if (!g) groups.set(domain, (g = { count: 0, hosts: new Map() }));
    g.count++;
    if (host !== domain) g.hosts.set(host, (g.hosts.get(host) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([domain, g]) => ({
      domain,
      count: g.count,
      subdomains: [...g.hosts.entries()]
        .map(([hostname, count]) => ({ hostname, count }))
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}
