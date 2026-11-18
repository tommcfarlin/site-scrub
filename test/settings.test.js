// @ts-check
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** @type {Record<string, any>} */
let store = {};
/** @type {Record<string, any>[]} */
let writes = [];
/** @type {any} */ (globalThis).chrome = {
  storage: {
    local: {
      get: async (/** @type {string[]} */ keys) => {
        /** @type {Record<string, any>} */
        const out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (/** @type {Record<string, any>} */ obj) => {
        writes.push({ ...obj });
        Object.assign(store, obj);
      },
    },
  },
};

const { DEFAULT_DOMAINS, sanitize, loadSettings, saveSettings } = await import("../settings.js");

beforeEach(() => {
  store = {};
  writes = [];
});

test("sanitize(undefined) returns the defaults", () => {
  assert.deepEqual(sanitize(undefined), {
    domains: DEFAULT_DOMAINS,
    kept: [],
    alsoRemove: { cookies: false, cache: false, storage: false },
    updateCheck: true,
    latestVersion: null,
    dismissedVersion: null,
  });
  assert.deepEqual(DEFAULT_DOMAINS, ["facebook.com", "reddit.com", "linkedin.com", "x.com", "twitter.com"]);
});

test("sanitize does not share the default array", () => {
  sanitize(undefined).domains.push("evil.com");
  assert.equal(DEFAULT_DOMAINS.length, 5);
});

test("sanitize handles bad domains", () => {
  assert.deepEqual(sanitize({ domains: "facebook.com" }).domains, DEFAULT_DOMAINS);
  assert.deepEqual(sanitize({ domains: ["a.com", 5, null] }).domains, ["a.com"]);
  assert.deepEqual(sanitize({ domains: [] }).domains, []);
});

test("sanitize trims, lowercases, drops empties and de-duplicates", () => {
  assert.deepEqual(sanitize({ domains: [" Facebook.COM ", "facebook.com", ""] }).domains, ["facebook.com"]);
  assert.deepEqual(sanitize({ kept: [" M.Facebook.COM ", "m.facebook.com", "  "] }).kept, ["m.facebook.com"]);
});

test("sanitize accepts only booleans for flags", () => {
  assert.equal(sanitize({ alsoRemove: { cookies: "yes" } }).alsoRemove.cookies, false);
  assert.equal(sanitize({ alsoRemove: { cache: true } }).alsoRemove.cache, true);
  assert.equal(sanitize({ alsoRemove: "x" }).alsoRemove.storage, false);
  assert.equal(sanitize({ updateCheck: 0 }).updateCheck, true);
  assert.equal(sanitize({ updateCheck: false }).updateCheck, false);
});

test("sanitize accepts dismissedVersion only as string or null", () => {
  assert.equal(sanitize({ dismissedVersion: "1.2.3" }).dismissedVersion, "1.2.3");
  assert.equal(sanitize({ dismissedVersion: 5 }).dismissedVersion, null);
  assert.equal(sanitize(undefined).dismissedVersion, null);
});

test("saveSettings stores dismissedVersion", async () => {
  await saveSettings({ dismissedVersion: "2.0.0" });
  assert.deepEqual(store, { dismissedVersion: "2.0.0" });
});

test("sanitize accepts latestVersion only as string or null", () => {
  assert.equal(sanitize({ latestVersion: "1.2.3" }).latestVersion, "1.2.3");
  assert.equal(sanitize({ latestVersion: 5 }).latestVersion, null);
  assert.equal(sanitize({ latestVersion: null }).latestVersion, null);
  assert.deepEqual(sanitize(null).kept, []);
  assert.deepEqual(sanitize("junk").domains, DEFAULT_DOMAINS);
});

test("loadSettings returns defaults for empty storage", async () => {
  assert.deepEqual(await loadSettings(), sanitize(undefined));
});

test("loadSettings keeps an explicitly empty domain list", async () => {
  store.domains = [];
  assert.deepEqual((await loadSettings()).domains, []);
});

test("loadSettings sanitizes stored data", async () => {
  store.domains = ["A.com", 3];
  store.updateCheck = "no";
  const s = await loadSettings();
  assert.deepEqual(s.domains, ["a.com"]);
  assert.equal(s.updateCheck, true);
});

test("saveSettings writes only the keys given", async () => {
  await saveSettings({ kept: ["a.b.com"] });
  assert.deepEqual(writes, [{ kept: ["a.b.com"] }]);
  assert.deepEqual(Object.keys(store), ["kept"]);
});

test("saveSettings stores sanitized values", async () => {
  // @ts-ignore: deliberately bad patch
  await saveSettings({ domains: [" X.com ", 5], updateCheck: "no", latestVersion: 7 });
  assert.deepEqual(store, { domains: ["x.com"], updateCheck: true, latestVersion: null });
});

test("saveSettings with an empty patch writes nothing", async () => {
  await saveSettings({});
  assert.equal(writes.length, 0);
});
