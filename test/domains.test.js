// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { registrableDomain } from "../domains.js";

test("registrableDomain handles common hosts", () => {
  assert.equal(registrableDomain("m.facebook.com"), "facebook.com");
  assert.equal(registrableDomain("www.bbc.co.uk"), "bbc.co.uk");
  assert.equal(registrableDomain("x.com"), "x.com");
  assert.equal(registrableDomain("xn--80ak6aa92e.com"), "xn--80ak6aa92e.com");
});

test("registrableDomain treats private suffixes as suffixes", () => {
  assert.equal(registrableDomain("a.github.io"), "a.github.io");
  assert.equal(registrableDomain("b.a.github.io"), "a.github.io");
});

test("registrableDomain handles wildcard and exception rules", () => {
  assert.equal(registrableDomain("a.b.ck"), "a.b.ck");
  assert.equal(registrableDomain("b.ck"), null);
  assert.equal(registrableDomain("www.ck"), "www.ck");
  assert.equal(registrableDomain("sub.www.ck"), "www.ck");
});

test("registrableDomain returns null for unusable hosts", () => {
  assert.equal(registrableDomain("co.uk"), null);
  assert.equal(registrableDomain("127.0.0.1"), null);
  assert.equal(registrableDomain("localhost"), null);
  assert.equal(registrableDomain("[::1]"), null);
  assert.equal(registrableDomain("facebook.com."), null);
});
