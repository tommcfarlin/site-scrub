// @ts-check
// Shared Playwright fixtures: a fresh Chromium profile per test with the
// unpacked extension loaded, its service worker, its id, and a helper that
// seeds browser history through the extension's own chrome.history API.

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test as base, chromium, expect } from "@playwright/test";

/** Repo root: the unpacked extension lives here. */
export const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {{
 *   context: import("@playwright/test").BrowserContext,
 *   serviceWorker: import("@playwright/test").Worker,
 *   extensionId: string,
 *   seedHistory: (urls: string[]) => Promise<void>,
 *   openSettings: () => Promise<import("@playwright/test").Page>,
 * }} ExtensionFixtures
 */

export const test = base.extend(/** @type {import("@playwright/test").Fixtures<ExtensionFixtures, {}, import("@playwright/test").PlaywrightTestArgs & import("@playwright/test").PlaywrightTestOptions, import("@playwright/test").PlaywrightWorkerArgs & import("@playwright/test").PlaywrightWorkerOptions>} */ ({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "site-scrub-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium", // full Chromium build: new headless mode, extensions allowed
      headless: true,
      args: [
        "--headless=new",
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    // chrome-extension://<id>/background.js
    await use(new URL(serviceWorker.url()).host);
  },

  seedHistory: async ({ serviceWorker }, use) => {
    await use(async (urls) => {
      await serviceWorker.evaluate(async (list) => {
        for (const url of list) await chrome.history.addUrl({ url });
      }, urls);
    });
  },

  openSettings: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      return page;
    });
  },
}));

export { expect };
