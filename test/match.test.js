// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScrubbed, collectMatches, groupByDomain } from "../match.js";

const fb = new Set(["facebook.com"]);
const keepWork = new Set(["work.facebook.com"]);

test("isScrubbed matches subdomains of a scrubbed domain", () => {
  assert.equal(isScrubbed("m.facebook.com", fb, new Set()), true);
});

test("isScrubbed honors Keep for the host and its subdomains", () => {
  assert.equal(isScrubbed("work.facebook.com", fb, keepWork), false);
  assert.equal(isScrubbed("a.work.facebook.com", fb, keepWork), false);
  assert.equal(isScrubbed("notwork.facebook.com", fb, keepWork), true);
});

test("isScrubbed ignores IP addresses", () => {
  assert.equal(isScrubbed("127.0.0.1", new Set(["127.0.0.1"]), new Set()), false);
});

test("collectMatches returns url/host pairs, skipping internal and kept", () => {
  const items = [
    { url: "https://m.facebook.com/a" },
    { url: "https://work.facebook.com/b" },
    { url: "chrome://settings" },
    { url: "https://example.org/" },
  ];
  assert.deepEqual(collectMatches(items, fb, keepWork), [
    { url: "https://m.facebook.com/a", host: "m.facebook.com" },
  ]);
});

test("groupByDomain groups by registrable domain with subdomains", () => {
  const groups = groupByDomain([
    { url: "https://facebook.com/" },
    { url: "https://m.facebook.com/x" },
    { url: "https://www.facebook.com/y" },
    { url: "https://www.bbc.co.uk/news" },
    { url: "chrome://settings" },
  ]);
  assert.deepEqual(groups, [
    { domain: "bbc.co.uk", count: 1, subdomains: [{ hostname: "www.bbc.co.uk", count: 1 }] },
    {
      domain: "facebook.com",
      count: 3,
      subdomains: [
        { hostname: "m.facebook.com", count: 1 },
        { hostname: "www.facebook.com", count: 1 },
      ],
    },
  ]);
});
