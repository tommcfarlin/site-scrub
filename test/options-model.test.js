// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isKept,
  itemsLabel,
  domainView,
  summaryText,
  matchesQuery,
} from "../options-model.js";

/** @type {import("../match.js").DomainGroup} */
const fb = {
  domain: "facebook.com",
  count: 8,
  subdomains: [
    { hostname: "m.facebook.com", count: 1 },
    { hostname: "work.facebook.com", count: 2 },
    { hostname: "www.facebook.com", count: 3 },
  ],
};
/** @type {import("../match.js").DomainGroup} */
const apple = { domain: "apple.com", count: 2, subdomains: [{ hostname: "support.apple.com", count: 1 }] };
/** @type {import("../match.js").DomainGroup} */
const example = { domain: "example.org", count: 1, subdomains: [] };

test("isKept covers the host and its subdomains, not lookalikes", () => {
  const kept = new Set(["work.facebook.com"]);
  assert.equal(isKept("work.facebook.com", kept), true);
  assert.equal(isKept("a.work.facebook.com", kept), true);
  assert.equal(isKept("notwork.facebook.com", kept), false);
  assert.equal(isKept("www.facebook.com", kept), false);
});

test("itemsLabel pluralizes", () => {
  assert.equal(itemsLabel(0), "0 items");
  assert.equal(itemsLabel(1), "1 item");
  assert.equal(itemsLabel(833), "833 items");
});

test("domainView with nothing kept counts every item", () => {
  assert.deepEqual(domainView(fb, new Set()), {
    count: 8,
    keptCount: 0,
    detail: "3 subdomains",
  });
});

test("domainView subtracts kept subdomains and notes them", () => {
  assert.deepEqual(domainView(fb, new Set(["work.facebook.com"])), {
    count: 6,
    keptCount: 1,
    detail: "3 subdomains · 1 kept",
  });
});

test("domainView detail is singular for one subdomain and says none for zero", () => {
  assert.equal(domainView(apple, new Set()).detail, "1 subdomain");
  assert.equal(domainView(example, new Set()).detail, "No subdomains");
});

test("domainView: a kept parent host covers deeper subdomains", () => {
  /** @type {import("../match.js").DomainGroup} */
  const g = {
    domain: "facebook.com",
    count: 5,
    subdomains: [
      { hostname: "a.work.facebook.com", count: 1 },
      { hostname: "work.facebook.com", count: 2 },
      { hostname: "www.facebook.com", count: 2 },
    ],
  };
  const v = domainView(g, new Set(["work.facebook.com"]));
  assert.equal(v.count, 2);
  assert.equal(v.keptCount, 2);
});

test("domainView: keeping the domain itself keeps everything", () => {
  const v = domainView(fb, new Set(["facebook.com"]));
  assert.equal(v.count, 0);
});

test("summaryText sums removable items over ticked domains only", () => {
  const groups = [apple, example, fb];
  const domains = new Set(["facebook.com", "apple.com", "x.com"]); // x.com not in history
  assert.equal(summaryText(groups, domains, new Set()), "2 sites · 10 items");
  assert.equal(summaryText(groups, domains, new Set(["work.facebook.com"])), "2 sites · 8 items");
  assert.equal(summaryText(groups, new Set(["example.org"]), new Set()), "1 site · 1 item");
  assert.equal(summaryText(groups, new Set(), new Set()), "0 sites · 0 items");
});

test("matchesQuery matches domain or any subdomain, trimmed and case-insensitive", () => {
  assert.equal(matchesQuery(fb, ""), true);
  assert.equal(matchesQuery(fb, "  "), true);
  assert.equal(matchesQuery(fb, "FACE"), true);
  assert.equal(matchesQuery(fb, "work."), true);
  assert.equal(matchesQuery(fb, " www "), true);
  assert.equal(matchesQuery(fb, "apple"), false);
  assert.equal(matchesQuery(example, "support"), false);
  assert.equal(matchesQuery(apple, "support"), true);
});
