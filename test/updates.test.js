// @ts-check
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** @type {Record<string, any>} */
let store = {};
/** @type {{ text: string }[]} */
let badges = [];
/** @type {{ name: string, info: any }[]} */
let created = [];
/** @type {Set<string>} */
let existing = new Set();

/** @type {any} */ (globalThis).chrome = {
  storage: {
    local: {
      get: async (/** @type {string[]} */ keys) => {
        /** @type {Record<string, any>} */
        const out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (/** @type {Record<string, any>} */ obj) => { Object.assign(store, obj); },
    },
  },
  runtime: { getManifest: () => ({ version: "1.0.0" }) },
  action: {
    setBadgeText: async (/** @type {{ text: string }} */ o) => { badges.push(o); },
    setBadgeBackgroundColor: async () => {},
  },
  alarms: {
    get: async (/** @type {string} */ name) => (existing.has(name) ? { name } : undefined),
    create: (/** @type {string} */ name, /** @type {any} */ info) => { created.push({ name, info }); },
  },
};

const { checkForUpdate, syncBadge, handleUpdateAlarm, registerUpdateAlarm, ALARM_NAME, VERSION_URL } =
  await import("../updates.js");

/** @param {any} body @param {{ ok?: boolean }} [opts] */
const fakeFetch = (body, opts = {}) => {
  /** @type {any[]} */
  const calls = [];
  /** @type {any} */
  const fn = async (/** @type {any} */ url, /** @type {any} */ init) => {
    calls.push([url, init]);
    return {
      ok: opts.ok ?? true,
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    };
  };
  fn.calls = calls;
  return fn;
};

beforeEach(() => {
  store = {};
  badges = [];
  created = [];
  existing = new Set();
});

test("checkForUpdate returns a newer version", async () => {
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({ version: "1.1.0" })), "1.1.0");
});

test("checkForUpdate requests the version file with no identifying data", async () => {
  const f = fakeFetch({ version: "1.1.0" });
  await checkForUpdate("1.0.0", f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "https://pressware.co/extensions/site-scrub/version.json");
  assert.equal(VERSION_URL, f.calls[0][0]);
  assert.deepEqual(f.calls[0][1], { cache: "no-store", credentials: "omit" });
});

test("checkForUpdate returns null for every bad case", async () => {
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({ version: "1.0.0" })), null);
  assert.equal(await checkForUpdate("1.1.0", fakeFetch({ version: "1.0.0" })), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch(new SyntaxError("bad json"))), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({})), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({ version: 2 })), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch(null)), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({ version: "v2" })), null);
  assert.equal(await checkForUpdate("1.0.0", fakeFetch({ version: "1.1.0" }, { ok: false })), null);
  const thrower = /** @type {any} */ (async () => { throw new TypeError("Failed to fetch"); });
  assert.equal(await checkForUpdate("1.0.0", thrower), null);
});

test("alarm handler does nothing for other alarms", async () => {
  const f = fakeFetch({ version: "2.0.0" });
  await handleUpdateAlarm({ name: "other" }, f);
  assert.equal(f.calls.length, 0);
});

test("alarm handler stops without a fetch when updateCheck is false", async () => {
  store.updateCheck = false;
  const f = fakeFetch({ version: "2.0.0" });
  await handleUpdateAlarm({ name: ALARM_NAME }, f);
  assert.equal(f.calls.length, 0);
  assert.equal("latestVersion" in store, false);
  assert.deepEqual(badges.at(-1), { text: "" });
});

test("alarm handler stores a newer version and sets the badge", async () => {
  await handleUpdateAlarm({ name: ALARM_NAME }, fakeFetch({ version: "1.2.0" }));
  assert.equal(store.latestVersion, "1.2.0");
  assert.deepEqual(badges.at(-1), { text: "•" });
});

test("alarm handler clears the badge when the stored version is not newer", async () => {
  store.latestVersion = "1.0.0";
  await handleUpdateAlarm({ name: ALARM_NAME }, fakeFetch({ version: "1.0.0" }));
  assert.deepEqual(badges.at(-1), { text: "" });
});

test("alarm handler ignores a bad payload and keeps the stored version", async () => {
  store.latestVersion = "1.5.0";
  await handleUpdateAlarm({ name: ALARM_NAME }, fakeFetch({ version: "garbage" }));
  assert.equal(store.latestVersion, "1.5.0");
  assert.deepEqual(badges.at(-1), { text: "•" });
});

test("registerUpdateAlarm creates a daily alarm once", async () => {
  await registerUpdateAlarm();
  assert.deepEqual(created, [{ name: "site-scrub-update-check", info: { periodInMinutes: 1440 } }]);
  existing.add(ALARM_NAME);
  await registerUpdateAlarm();
  assert.equal(created.length, 1);
});

test("syncBadge: Later clears the dot, and a newer version brings it back", async () => {
  store = { latestVersion: "1.1.0", dismissedVersion: "1.1.0" };
  await syncBadge();
  assert.equal(badges.at(-1)?.text, "");
  store = { latestVersion: "1.2.0", dismissedVersion: "1.1.0" };
  await syncBadge();
  assert.notEqual(badges.at(-1)?.text, "");
});
