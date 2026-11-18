// @ts-check
// Unit tests for the pure decision-logic in lib.js — the code that determines
// which URLs get permanently deleted. Run with: npm test  (or: node --test)
//
// These functions have no chrome.* dependency at module load, so they run in
// plain Node with the built-in test runner.

import { test } from "node:test";
import assert from "node:assert/strict";

import { hostnameFromUrl } from "../lib.js";

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

test("hostnameFromUrl: drops a trailing dot", () => {
  assert.equal(hostnameFromUrl("https://facebook.com./feed"), "facebook.com");
});
