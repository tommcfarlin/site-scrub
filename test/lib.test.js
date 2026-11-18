// @ts-check
// Unit tests for the pure decision-logic in lib.js — the code that determines
// which URLs get permanently deleted. Run with: npm test  (or: node --test)
//
// These functions have no chrome.* dependency at module load, so they run in
// plain Node with the built-in test runner.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hostnameFromUrl,
  isPreChecked,
  tallyByHostname,
  collectMatches,
  TARGET_DOMAINS,
} from "../lib.js";

test("hostnameFromUrl: normalizes port, userinfo, and case", () => {
  assert.equal(hostnameFromUrl("http://User:p@FACEBOOK.com:8443/x"), "facebook.com");
  assert.equal(hostnameFromUrl("https://M.Facebook.com/feed"), "m.facebook.com");
});

test("hostnameFromUrl: excludes non-http(s) schemes and junk", () => {
  for (const url of ["ftp://facebook.com/", "data:text/plain,hi", "about:blank",
                      "chrome://history", "brave://settings", "file:///etc/hosts", "not a url", ""]) {
    assert.equal(hostnameFromUrl(url), null, `expected null for ${JSON.stringify(url)}`);
  }
});

test("hostnameFromUrl: IP literals and punycode are preserved as-is", () => {
  assert.equal(hostnameFromUrl("http://127.0.0.1:9/"), "127.0.0.1");
  assert.equal(hostnameFromUrl("http://xn--80ak6aa92e.com/"), "xn--80ak6aa92e.com");
});

test("hostnameFromUrl: trailing dot is kept (documents intentional behavior)", () => {
  // A trailing-dot host will NOT match a selected 'facebook.com'. Documented so
  // a future change to this behavior is a conscious decision.
  assert.equal(hostnameFromUrl("http://facebook.com./"), "facebook.com.");
});

test("isPreChecked: matches each target domain and its subdomains", () => {
  assert.ok(isPreChecked("facebook.com"));
  assert.ok(isPreChecked("www.facebook.com"));
  assert.ok(isPreChecked("business.facebook.com"));
  assert.ok(isPreChecked("x.com"));
  assert.ok(isPreChecked("mobile.twitter.com"));
  assert.ok(isPreChecked("reddit.com"));
  assert.ok(isPreChecked("linkedin.com"));
});

test("isPreChecked: rejects lookalikes and unrelated domains", () => {
  for (const host of ["notx.com", "evilx.com", "x.com.evil.com",
                      "myfacebook.com", "facebook.com.evil.com", "example.com"]) {
    assert.equal(isPreChecked(host), false, `${host} must not be pre-checked`);
  }
});

test("TARGET_DOMAINS: includes both x.com and legacy twitter.com", () => {
  assert.ok(TARGET_DOMAINS.includes("x.com"));
  assert.ok(TARGET_DOMAINS.includes("twitter.com"));
});

test("tallyByHostname: counts distinct URLs per host, alphabetical, skips non-http", () => {
  const items = [
    { url: "https://www.reddit.com/r/a" },
    { url: "https://www.reddit.com/r/b" },
    { url: "https://facebook.com/" },
    { url: "chrome://history" },   // skipped
    { url: "not a url" },          // skipped
  ];
  assert.deepEqual(tallyByHostname(items), [
    { hostname: "facebook.com", count: 1 },
    { hostname: "www.reddit.com", count: 2 },
  ]);
});

test("tallyByHostname: empty input yields empty list", () => {
  assert.deepEqual(tallyByHostname([]), []);
});

test("collectMatches: returns {url, host} only for selected hosts", () => {
  const items = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://example.com/3" },
    { url: "chrome://history" },
  ];
  const selected = new Set(["facebook.com", "m.facebook.com"]);
  assert.deepEqual(collectMatches(items, selected), [
    { url: "https://facebook.com/1", host: "facebook.com" },
    { url: "https://m.facebook.com/2", host: "m.facebook.com" },
  ]);
});

test("collectMatches: full-hostname match does not sweep in sibling subdomains", () => {
  const items = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
  ];
  // Selecting only the bare domain must NOT delete the m. subdomain.
  const selected = new Set(["facebook.com"]);
  assert.deepEqual(collectMatches(items, selected), [
    { url: "https://facebook.com/1", host: "facebook.com" },
  ]);
});

test("collectMatches: nothing selected → no matches", () => {
  const items = [{ url: "https://facebook.com/1" }];
  assert.deepEqual(collectMatches(items, new Set()), []);
});
