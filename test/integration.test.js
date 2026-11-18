// @ts-check
// Integration tests for the service-worker orchestration in background.js.
//
// background.js registers its listeners against the global `chrome` at import
// time, so we install a programmable fake `chrome` BEFORE importing it, then
// drive the flow through the captured listeners. node --test runs each test
// file in its own process, so this global install is isolated from lib.test.js.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- programmable fake chrome -------------------------------------------

function makeChrome() {
  /** @type {{ action: Function[], notifButton: Function[], notifClosed: Function[] }} */
  const listeners = { action: [], notifButton: [], notifClosed: [] };
  /** @type {{ historyItems: { url: string }[], storageLocal: Record<string, any>, storageSession: Record<string, any>, deleted: string[], notifications: { id: string, opts: any }[], injected: any[], openedOptions: number, searchCount: number, siteDataCalls: { options: any, dataToRemove: any, deletedSoFar: number }[] }} */
  const state = {
    historyItems: [],   // [{ url }]
    storageLocal: {},
    storageSession: {},
    deleted: [],        // urls passed to history.deleteUrl
    notifications: [],  // { id, opts }
    injected: [],       // executeScript args
    openedOptions: 0,
    searchCount: 0,
    siteDataCalls: [],  // chrome.browsingData.remove calls
  };
  /** @type {{ executeScript: (arg?: any) => Promise<any>, deleteUrlRejectUrls: Set<string>, browsingDataGranted: boolean, browsingDataReject: boolean }} */
  const config = {
    executeScript: async () => [{ result: undefined }],
    deleteUrlRejectUrls: new Set(),
    browsingDataGranted: true,
    browsingDataReject: false,
  };

  /** @type {any} */
  const chrome = {
    action: { onClicked: { addListener: (/** @type {any} */ fn) => listeners.action.push(fn) } },
    history: {
      search: async () => { state.searchCount++; return state.historyItems.slice(); },
      deleteUrl: async (/** @type {any} */ { url }) => {
        state.deleted.push(url);
        if (config.deleteUrlRejectUrls.has(url)) throw new Error("delete failed");
      },
    },
    storage: {
      local: {
        get: async (/** @type {any} */ key) => {
          /** @type {Record<string, any>} */
          const out = {};
          for (const k of Array.isArray(key) ? key : [key]) {
            if (k in state.storageLocal) out[k] = state.storageLocal[k];
          }
          return out;
        },
        set: async (/** @type {any} */ obj) => { Object.assign(state.storageLocal, obj); },
      },
      session: {
        get: async (/** @type {any} */ key) => ({ [key]: state.storageSession[key] }),
        set: async (/** @type {any} */ obj) => { Object.assign(state.storageSession, obj); },
      },
    },
    scripting: {
      executeScript: async (/** @type {any} */ arg) => { state.injected.push(arg); return config.executeScript(arg); },
    },
    notifications: {
      create: (/** @type {any} */ opts, /** @type {any} */ cb) => {
        const id = "n" + state.notifications.length;
        state.notifications.push({ id, opts });
        if (cb) cb(id);
        return id;
      },
      clear: async () => {},
      onButtonClicked: { addListener: (/** @type {any} */ fn) => listeners.notifButton.push(fn) },
      onClosed: { addListener: (/** @type {any} */ fn) => listeners.notifClosed.push(fn) },
    },
    runtime: { openOptionsPage: () => { state.openedOptions++; } },
    permissions: { contains: async () => config.browsingDataGranted },
    browsingData: {
      remove: async (/** @type {any} */ options, /** @type {any} */ dataToRemove) => {
        state.siteDataCalls.push({ options, dataToRemove, deletedSoFar: state.deleted.length });
        if (config.browsingDataReject) throw new Error("browsingData failed");
      },
    },
  };

  function reset() {
    state.historyItems = [];
    state.storageLocal = {};
    state.storageSession = {};
    state.deleted = [];
    state.notifications = [];
    state.injected = [];
    state.openedOptions = 0;
    state.searchCount = 0;
    state.siteDataCalls = [];
    config.executeScript = async () => [{ result: undefined }];
    config.deleteUrlRejectUrls = new Set();
    config.browsingDataGranted = true;
    config.browsingDataReject = false;
  }

  return { chrome, listeners, state, config, reset };
}

const mock = makeChrome();
// @ts-ignore: installing the fake chrome global for background.js
globalThis.chrome = mock.chrome;
await import("../background.js"); // registers listeners against the fake chrome

const onClicked = mock.listeners.action[0];
const onNotifButton = mock.listeners.notifButton[0];
const { state, config } = mock;

beforeEach(() => mock.reset());

// ---- tests ---------------------------------------------------------------

test("confirmed purge on a normal page deletes exactly the selected scope", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://example.com/3" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => [{ result: true }]; // confirm = Scrub (and sponge)

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted.sort(), [
    "https://facebook.com/1",
    "https://m.facebook.com/2",
  ]);
  assert.equal(state.openedOptions, 0);
});

test("scope by domain: facebook.com covers m.facebook.com", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://example.com/3" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted.sort(), [
    "https://facebook.com/1",
    "https://m.facebook.com/2",
  ]);
});

test("kept host survives and the dialog count excludes it", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://work.facebook.com/2" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.kept = ["work.facebook.com"];
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  const dialog = state.injected[0].args[0];
  assert.equal(dialog.message, "Permanently remove history from 1 site (1 history item).");
});

test("notification fallback stores domains and kept; Scrub deletes the same set", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://work.facebook.com/3" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.kept = ["work.facebook.com"];
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });

  assert.deepEqual(state.storageSession.pendingPurge["n0"], {
    domains: ["facebook.com"],
    kept: ["work.facebook.com"],
    alsoRemove: { cookies: false, cache: false, storage: false },
  });
  assert.equal(state.notifications[0].opts.message, "Permanently remove history from 2 sites (2 history items).");

  await onNotifButton("n0", 0);

  assert.deepEqual(state.deleted.sort(), ["https://facebook.com/1", "https://m.facebook.com/2"]);
});

test("cancel on the confirm deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => [{ result: false }]; // Cancel

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, []);
});

test("empty domain list opens options and deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = []; // explicitly nothing selected

  await onClicked({ id: 1 });

  assert.equal(state.openedOptions, 1);
  assert.deepEqual(state.deleted, []);
});

test("selection with no matching history shows a dialog, deletes nothing", async () => {
  state.historyItems = [{ url: "https://example.com/1" }];
  state.storageLocal.domains = ["reddit.com"];
  config.executeScript = async () => [{ result: true }]; // info dialog acknowledged

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, []);
  assert.equal(state.injected.length, 1); // the info dialog was shown
});

test("first-ever click (no stored settings) scrubs the five default domains", async () => {
  state.historyItems = [
    { url: "https://www.reddit.com/r/a" },
    { url: "https://x.com/home" },
    { url: "https://example.com/keep" }, // not a target → must survive
  ];
  // no stored settings → the five default domains apply
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted.sort(), [
    "https://www.reddit.com/r/a",
    "https://x.com/home",
  ]);
});

test("internal page falls back to a durable notification confirm", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => { throw new Error("cannot inject on internal page"); };

  await onClicked({ id: 1 });

  // Nothing deleted yet — awaiting the notification decision.
  assert.deepEqual(state.deleted, []);
  assert.equal(state.notifications.length, 1);
  // Pending purge persisted to session storage, keyed by notification id.
  const pending = state.storageSession.pendingPurge;
  assert.ok(pending && pending["n0"]);
  assert.deepEqual(pending["n0"], {
    domains: ["facebook.com"],
    kept: [],
    alsoRemove: { cookies: false, cache: false, storage: false },
  });

  // User clicks "Scrub" (button index 0) — handled by the durable top-level listener.
  await onNotifButton("n0", 0);

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  assert.equal(state.storageSession.pendingPurge["n0"], undefined); // cleared
});

test("notification 'Cancel' (button index 1) deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  await onNotifButton("n0", 1); // Cancel

  assert.deepEqual(state.deleted, []);
});

test("partial deletion failure is tolerated and reported", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://facebook.com/2" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  config.executeScript = async () => { throw new Error("internal page"); }; // force notification path
  config.deleteUrlRejectUrls = new Set(["https://facebook.com/2"]);

  await onClicked({ id: 1 });
  await onNotifButton("n0", 0); // Scrub

  // Both were attempted; the "Scrubbed" result notification reflects the failure.
  assert.deepEqual(state.deleted.sort(), ["https://facebook.com/1", "https://facebook.com/2"]);
  const last = state.notifications.at(-1);
  assert.ok(last);
  assert.equal(last.opts.message, "Removed history from 1 site (1 history item, 1 could not be removed).");
});

test("re-entrancy guard ignores a second click while one is mid-confirm", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];

  // Make the first confirm injection hang until we release it.
  /** @type {(() => void) | undefined} */
  let releaseConfirm;
  let gated = false;
  config.executeScript = async () => {
    if (!gated) {
      gated = true;
      return new Promise((res) => { releaseConfirm = () => res([{ result: true }]); });
    }
    return [{ result: true }]; // later calls (e.g. sponge) resolve immediately
  };

  const p1 = onClicked({ id: 1 }); // starts, scans once, hangs on confirm
  const p2 = onClicked({ id: 1 }); // busy → ignored immediately
  await p2;

  // Let p1 progress until it reaches (and hangs on) the confirm injection.
  for (let i = 0; i < 50 && typeof releaseConfirm !== "function"; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }

  assert.equal(state.searchCount, 1, "second click must not scan");

  /** @type {() => void} */ (releaseConfirm)();
  await p1;

  assert.equal(state.searchCount, 1, "still only one scan total");
  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
});

test("scrub removes site data for active types only", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://m.facebook.com/3" },
    { url: "https://example.com/4" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: false, storage: true };
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.equal(
    state.injected[0].args[0].message,
    "Permanently remove history, cookies, and site storage from 2 sites (3 history items)."
  );
  assert.equal(state.siteDataCalls.length, 1);
  const [call] = state.siteDataCalls;
  assert.deepEqual(call.options, {
    origins: ["https://facebook.com", "http://facebook.com", "https://m.facebook.com", "http://m.facebook.com"],
  });
  assert.deepEqual(call.dataToRemove, {
    cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true,
  });
  assert.equal(call.deletedSoFar, 3, "site data is removed after the history deletion");
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history, cookies, and site storage from 2 sites (3 history items)."
  );
});

test("no site data call when alsoRemove is all false", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: false, cache: false, storage: false };
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  assert.equal(state.siteDataCalls.length, 0);
  assert.equal(state.injected[0].args[0].message, "Permanently remove history from 1 site (1 history item).");
});

test("notification path removes site data read at scrub time", async () => {
  state.historyItems = [{ url: "https://www.reddit.com/r/a" }];
  state.storageLocal.domains = ["reddit.com"];
  state.storageLocal.alsoRemove = { cookies: false, cache: true, storage: false };
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  assert.equal(state.notifications[0].opts.message, "Permanently remove history and cached files from 1 site (1 history item).");

  await onNotifButton("n0", 0);

  assert.deepEqual(state.siteDataCalls.map((c) => c.dataToRemove), [{ cache: true }]);
  assert.equal(state.notifications.at(-1)?.opts.message, "Removed history and cached files from 1 site (1 history item).");
});

test("missing browsingData permission still scrubs history", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: false, storage: false };
  config.browsingDataGranted = false;
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  assert.equal(state.siteDataCalls.length, 0);
  assert.equal(
    state.injected[0].args[0].message,
    "Permanently remove history from 1 site (1 history item). Cookies are skipped because the permission is off."
  );
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history from 1 site (1 history item). Cookies are skipped because the permission is off."
  );
});

test("a site data failure still shows the result with a short extra sentence", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: false, storage: false };
  config.browsingDataReject = true;
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  await onNotifButton("n0", 0);

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  assert.equal(
    state.notifications.at(-1)?.opts.message,
    "Removed history from 1 site (1 history item). Cookies could not be removed."
  );
});

// ---- fix round 1: Keep wins for cookies; messages match what happened -----

test("kept subdomain: cookies are not removed for its domain, cache still is", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://m.facebook.com/2" },
    { url: "https://work.facebook.com/3" },
  ];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.kept = ["work.facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: true, storage: false };
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.equal(
    state.injected[0].args[0].message,
    "Permanently remove history and cached files from 2 sites (2 history items). " +
      "Cookies are kept for 1 site with a kept subdomain."
  );
  assert.ok(state.siteDataCalls.every((c) => !c.dataToRemove.cookies), "no cookie removal for facebook hosts");
  assert.deepEqual(state.siteDataCalls.map((c) => [c.options, c.dataToRemove]), [[
    { origins: ["https://facebook.com", "http://facebook.com", "https://m.facebook.com", "http://m.facebook.com"] },
    { cache: true },
  ]]);
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history and cached files from 2 sites (2 history items). Cookies are kept for 1 site with a kept subdomain."
  );
});

test("kept subdomain on one domain still removes cookies for the other domains", async () => {
  state.historyItems = [
    { url: "https://facebook.com/1" },
    { url: "https://work.facebook.com/2" },
    { url: "https://www.reddit.com/3" },
  ];
  state.storageLocal.domains = ["facebook.com", "reddit.com"];
  state.storageLocal.kept = ["work.facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: true, storage: false };
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.siteDataCalls.map((c) => [c.options.origins, c.dataToRemove]), [
    [["https://www.reddit.com", "http://www.reddit.com"], { cookies: true }],
    [["https://facebook.com", "http://facebook.com", "https://www.reddit.com", "http://www.reddit.com"], { cache: true }],
  ]);
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history, cookies, and cached files from 2 sites (2 history items). " +
      "Cookies are kept for 1 site with a kept subdomain."
  );
});

test("no kept entry: cookies and cache are removed together", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }, { url: "https://m.facebook.com/2" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: true, storage: false };
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.siteDataCalls.map((c) => c.dataToRemove), [{ cookies: true, cache: true }]);
  assert.equal(
    state.injected[0].args[0].message,
    "Permanently remove history, cookies, and cached files from 2 sites (2 history items)."
  );
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history, cookies, and cached files from 2 sites (2 history items)."
  );
});

test("notification path: kept subdomain note shows in the confirm and the result", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }, { url: "https://work.facebook.com/2" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.kept = ["work.facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: false, storage: false };
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  assert.equal(
    state.notifications[0].opts.message,
    "Permanently remove history from 1 site (1 history item). Cookies are kept for 1 site with a kept subdomain."
  );

  await onNotifButton("n0", 0);

  assert.equal(state.siteDataCalls.length, 0);
  assert.equal(
    state.notifications.at(-1)?.opts.message,
    "Removed history from 1 site (1 history item). Cookies are kept for 1 site with a kept subdomain."
  );
});

test("missing permission: the dialog and result name only history and the skipped types", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }, { url: "https://www.reddit.com/2" }];
  state.storageLocal.domains = ["facebook.com", "reddit.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: true, storage: false };
  config.browsingDataGranted = false;
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  assert.equal(
    state.notifications[0].opts.message,
    "Permanently remove history from 2 sites (2 history items). " +
      "Cookies and cached files are skipped because the permission is off."
  );

  await onNotifButton("n0", 0);

  assert.equal(state.siteDataCalls.length, 0);
  assert.equal(
    state.notifications.at(-1)?.opts.message,
    "Removed history from 2 sites (2 history items). Cookies and cached files are skipped because the permission is off."
  );
});

test("permission revoked after the confirm: the result says the types were skipped", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: true, cache: false, storage: false };
  config.executeScript = async () => {
    config.browsingDataGranted = false; // revoked while the dialog is open
    return [{ result: true }];
  };

  await onClicked({ id: 1 });

  assert.equal(state.injected[0].args[0].message, "Permanently remove history and cookies from 1 site (1 history item).");
  assert.equal(state.siteDataCalls.length, 0);
  assert.equal(
    state.injected.at(-1).args[0],
    "Removed history from 1 site (1 history item). Cookies are skipped because the permission is off."
  );
});

test("notification path uses the types read at click time, not later edits", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.domains = ["facebook.com"];
  state.storageLocal.alsoRemove = { cookies: false, cache: true, storage: false };
  config.executeScript = async () => { throw new Error("internal page"); };

  await onClicked({ id: 1 });
  state.storageLocal.alsoRemove = { cookies: true, cache: true, storage: true }; // changed while open
  await onNotifButton("n0", 0);

  assert.deepEqual(state.siteDataCalls.map((c) => c.dataToRemove), [{ cache: true }]);
  assert.equal(
    state.notifications.at(-1)?.opts.message,
    "Removed history and cached files from 1 site (1 history item)."
  );
});
