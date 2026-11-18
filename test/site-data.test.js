// @ts-check
// Unit tests for site-data.js against a fake `chrome` (permissions and
// browsingData). Each test file runs in its own process, so the global is safe.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** @type {{ removeCalls: any[][], requestCalls: any[], containsResult: boolean, requestResult: boolean | Error, removeError: Error | null }} */
const fake = { removeCalls: [], requestCalls: [], containsResult: true, requestResult: true, removeError: null };

/** @type {any} */ (globalThis).chrome = {
  permissions: {
    contains: async () => fake.containsResult,
    request: async (/** @type {any} */ p) => {
      fake.requestCalls.push(p);
      if (fake.requestResult instanceof Error) throw fake.requestResult;
      return fake.requestResult;
    },
  },
  browsingData: {
    remove: async (/** @type {any} */ options, /** @type {any} */ dataToRemove) => {
      fake.removeCalls.push([options, dataToRemove]);
      if (fake.removeError) throw fake.removeError;
    },
  },
};

const { originsFor, ensurePermission, removeSiteData, removalPhrase, dataPhrase } = await import("../site-data.js");

const OFF = { cookies: false, cache: false, storage: false };

beforeEach(() => {
  fake.removeCalls = [];
  fake.requestCalls = [];
  fake.containsResult = true;
  fake.requestResult = true;
  fake.removeError = null;
});

test("originsFor gives https then http for each hostname", () => {
  assert.deepEqual(originsFor(["a.com"]), ["https://a.com", "http://a.com"]);
});

test("originsFor de-duplicates and keeps first-seen order", () => {
  assert.deepEqual(originsFor(["b.com", "a.com", "b.com"]), [
    "https://b.com", "http://b.com", "https://a.com", "http://a.com",
  ]);
  assert.deepEqual(originsFor([]), []);
});

test("removeSiteData with all types off makes no call", async () => {
  await removeSiteData(["a.com"], OFF);
  assert.equal(fake.removeCalls.length, 0);
});

test("removeSiteData with no hostnames makes no call", async () => {
  await removeSiteData([], { cookies: true, cache: true, storage: true });
  assert.equal(fake.removeCalls.length, 0);
});

test("cookies only calls browsingData.remove once with the origins and {cookies: true}", async () => {
  await removeSiteData(["a.com", "www.a.com"], { ...OFF, cookies: true });
  assert.deepEqual(fake.removeCalls, [[
    { origins: ["https://a.com", "http://a.com", "https://www.a.com", "http://www.a.com"] },
    { cookies: true },
  ]]);
});

test("cache maps to cache", async () => {
  await removeSiteData(["a.com"], { ...OFF, cache: true });
  assert.deepEqual(fake.removeCalls[0][1], { cache: true });
});

test("storage maps to localStorage, indexedDB, serviceWorkers, and cacheStorage", async () => {
  await removeSiteData(["a.com"], { ...OFF, storage: true });
  assert.deepEqual(fake.removeCalls[0][1], {
    localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true,
  });
});

test("all types together make one call with every data type", async () => {
  await removeSiteData(["a.com"], { cookies: true, cache: true, storage: true });
  assert.equal(fake.removeCalls.length, 1);
  assert.deepEqual(fake.removeCalls[0][1], {
    cookies: true, cache: true, localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true,
  });
});

test("missing permission at removal time makes no call and does not throw", async () => {
  fake.containsResult = false;
  await removeSiteData(["a.com"], { cookies: true, cache: true, storage: true });
  assert.equal(fake.removeCalls.length, 0);
});

test("a browsingData failure rejects so the caller can report it", async () => {
  fake.removeError = new Error("boom");
  await assert.rejects(removeSiteData(["a.com"], { ...OFF, cookies: true }), /boom/);
});

test("ensurePermission requests the optional browsingData permission", async () => {
  assert.equal(await ensurePermission(), true);
  assert.deepEqual(fake.requestCalls, [{ permissions: ["browsingData"] }]);
});

test("ensurePermission returns false when the user denies", async () => {
  fake.requestResult = false;
  assert.equal(await ensurePermission(), false);
});

test("ensurePermission returns false when the request rejects", async () => {
  fake.requestResult = new Error("not allowed");
  assert.equal(await ensurePermission(), false);
});

test("removalPhrase names history plus the active types", () => {
  assert.equal(removalPhrase(OFF), "history");
  assert.equal(removalPhrase({ ...OFF, cookies: true }), "history and cookies");
  assert.equal(removalPhrase({ ...OFF, cookies: true, cache: true }), "history, cookies, and cached files");
  assert.equal(removalPhrase({ ...OFF, storage: true }), "history and site storage");
  assert.equal(
    removalPhrase({ cookies: true, cache: true, storage: true }),
    "history, cookies, cached files, and site storage"
  );
});

test("dataPhrase names only the active data types", () => {
  assert.equal(dataPhrase(OFF), "");
  assert.equal(dataPhrase({ ...OFF, cache: true }), "cached files");
  assert.equal(dataPhrase({ ...OFF, cache: true, storage: true }), "cached files and site storage");
  assert.equal(dataPhrase({ cookies: true, cache: true, storage: true }), "cookies, cached files, and site storage");
});
