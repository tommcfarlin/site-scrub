// @ts-check
// Playwright config for the end-to-end tests in e2e/. Each test launches
// Chromium (new headless mode) with a persistent context that loads the
// unpacked extension from the repo root; see e2e/fixtures.js.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
