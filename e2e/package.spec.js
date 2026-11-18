// @ts-check
// The release zip is what users install. Build it, unpack it, load the
// unpacked copy as the extension, and check the settings page opens.

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { test as base, chromium, expect } from "@playwright/test";
import { EXTENSION_PATH } from "./fixtures.js";

const MUST_HAVE = ["manifest.json", "background.js", "options.html", "psl-data.js"];
const MUST_NOT_HAVE = ["test/", "e2e/", "docs/", "personas/", "node_modules/", "playwright.config.js", "package.json"];

base("the packaged zip loads and opens the settings page", async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "site-scrub-zip-"));
  /** @type {import("@playwright/test").BrowserContext | undefined} */
  let context;
  try {
    execFileSync("node", ["scripts/package.js"], { cwd: EXTENSION_PATH, stdio: "pipe" });
    const { version } = JSON.parse(await fs.readFile(path.join(EXTENSION_PATH, "manifest.json"), "utf8"));
    const zip = path.join(EXTENSION_PATH, "dist", `site-scrub-${version}.zip`);

    const listing = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const name of MUST_HAVE) expect(listing).toContain(name);
    for (const bad of MUST_NOT_HAVE) {
      expect(listing.filter((n) => n === bad || n.startsWith(bad))).toEqual([]);
    }

    const unpacked = path.join(work, "extension");
    execFileSync("unzip", ["-q", zip, "-d", unpacked]);

    context = await chromium.launchPersistentContext(path.join(work, "profile"), {
      channel: "chromium",
      headless: true,
      args: ["--headless=new", `--disable-extensions-except=${unpacked}`, `--load-extension=${unpacked}`],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    const id = new URL(sw.url()).host;

    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    await expect(page.getByRole("heading", { name: "Site Scrub" })).toBeVisible();
  } finally {
    await context?.close();
    await fs.rm(work, { recursive: true, force: true });
  }
});
