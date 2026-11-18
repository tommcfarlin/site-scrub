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
  const listeners = { action: [], notifButton: [], notifClosed: [] };
  const state = {
    historyItems: [],   // [{ url }]
    storageLocal: {},
    storageSession: {},
    deleted: [],        // urls passed to history.deleteUrl
    notifications: [],  // { id, opts }
    injected: [],       // executeScript args
    openedOptions: 0,
    searchCount: 0,
  };
  const config = {
    executeScript: async () => [{ result: undefined }],
    deleteUrlRejectUrls: new Set(),
  };

  const chrome = {
    action: { onClicked: { addListener: (fn) => listeners.action.push(fn) } },
    history: {
      search: async () => { state.searchCount++; return state.historyItems.slice(); },
      deleteUrl: async ({ url }) => {
        state.deleted.push(url);
        if (config.deleteUrlRejectUrls.has(url)) throw new Error("delete failed");
      },
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: state.storageLocal[key] }),
        set: async (obj) => { Object.assign(state.storageLocal, obj); },
      },
      session: {
        get: async (key) => ({ [key]: state.storageSession[key] }),
        set: async (obj) => { Object.assign(state.storageSession, obj); },
      },
    },
    scripting: {
      executeScript: async (arg) => { state.injected.push(arg); return config.executeScript(arg); },
    },
    notifications: {
      create: (opts, cb) => {
        const id = "n" + state.notifications.length;
        state.notifications.push({ id, opts });
        if (cb) cb(id);
        return id;
      },
      clear: async () => {},
      onButtonClicked: { addListener: (fn) => listeners.notifButton.push(fn) },
      onClosed: { addListener: (fn) => listeners.notifClosed.push(fn) },
    },
    runtime: { openOptionsPage: () => { state.openedOptions++; } },
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
    config.executeScript = async () => [{ result: undefined }];
    config.deleteUrlRejectUrls = new Set();
  }

  return { chrome, listeners, state, config, reset };
}

const mock = makeChrome();
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
  state.storageLocal.selected = ["facebook.com", "m.facebook.com"];
  config.executeScript = async () => [{ result: true }]; // confirm = Scrub (and sponge)

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted.sort(), [
    "https://facebook.com/1",
    "https://m.facebook.com/2",
  ]);
  assert.equal(state.openedOptions, 0);
});

test("cancel on the confirm deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.selected = ["facebook.com"];
  config.executeScript = async () => [{ result: false }]; // Cancel

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, []);
});

test("empty selection opens options and deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.selected = []; // explicitly nothing selected

  await onClicked({ id: 1 });

  assert.equal(state.openedOptions, 1);
  assert.deepEqual(state.deleted, []);
});

test("selection with no matching history shows a dialog, deletes nothing", async () => {
  state.historyItems = [{ url: "https://example.com/1" }];
  state.storageLocal.selected = ["reddit.com"];
  config.executeScript = async () => [{ result: true }]; // info dialog acknowledged

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted, []);
  assert.equal(state.injected.length, 1); // the info dialog was shown
});

test("first-ever click (no saved selection) uses pre-checked defaults", async () => {
  state.historyItems = [
    { url: "https://www.reddit.com/r/a" },
    { url: "https://x.com/home" },
    { url: "https://example.com/keep" }, // not a target → must survive
  ];
  // no state.storageLocal.selected → defaults kick in
  config.executeScript = async () => [{ result: true }];

  await onClicked({ id: 1 });

  assert.deepEqual(state.deleted.sort(), [
    "https://www.reddit.com/r/a",
    "https://x.com/home",
  ]);
});

test("internal page falls back to a durable notification confirm", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.selected = ["facebook.com"];
  config.executeScript = async () => { throw new Error("cannot inject on internal page"); };

  await onClicked({ id: 1 });

  // Nothing deleted yet — awaiting the notification decision.
  assert.deepEqual(state.deleted, []);
  assert.equal(state.notifications.length, 1);
  // Pending purge persisted to session storage, keyed by notification id.
  const pending = state.storageSession.pendingPurge;
  assert.ok(pending && pending["n0"]);
  assert.deepEqual(pending["n0"], ["facebook.com"]);

  // User clicks "Scrub" (button index 0) — handled by the durable top-level listener.
  await onNotifButton("n0", 0);

  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
  assert.equal(state.storageSession.pendingPurge["n0"], undefined); // cleared
});

test("notification 'Cancel' (button index 1) deletes nothing", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.selected = ["facebook.com"];
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
  state.storageLocal.selected = ["facebook.com"];
  config.executeScript = async () => { throw new Error("internal page"); }; // force notification path
  config.deleteUrlRejectUrls = new Set(["https://facebook.com/2"]);

  await onClicked({ id: 1 });
  await onNotifButton("n0", 0); // Scrub

  // Both were attempted; the "Scrubbed" result notification reflects the failure.
  assert.deepEqual(state.deleted.sort(), ["https://facebook.com/1", "https://facebook.com/2"]);
  const last = state.notifications.at(-1);
  assert.match(last.opts.message, /Removed 1 item/);
  assert.match(last.opts.message, /could not be removed/);
});

test("re-entrancy guard ignores a second click while one is mid-confirm", async () => {
  state.historyItems = [{ url: "https://facebook.com/1" }];
  state.storageLocal.selected = ["facebook.com"];

  // Make the first confirm injection hang until we release it.
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

  releaseConfirm();
  await p1;

  assert.equal(state.searchCount, 1, "still only one scan total");
  assert.deepEqual(state.deleted, ["https://facebook.com/1"]);
});
