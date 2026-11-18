// @ts-check
// The in-page scrub dialog, injected into a plain page. No extension is needed:
// dialogInPage is self-contained, so the test runs its source in the page the
// same way chrome.scripting.executeScript does.

import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { EXTENSION_PATH } from "./fixtures.js";

const SOURCE = await fs.readFile(path.join(EXTENSION_PATH, "injected-ui.js"), "utf8");
const FN = SOURCE.slice(SOURCE.indexOf("function dialogInPage"), SOURCE.indexOf("// Transient"));

const OPTS = {
  title: "Scrub your history?",
  message: "Permanently remove history from 2 sites (12 history items).",
  buttons: [
    { label: "Cancel", value: false },
    { label: "Scrub", value: true, destructive: true, requireTrusted: true },
  ],
  dismissValue: false,
  autofocusIndex: 0,
};

/** @param {import("@playwright/test").Page} page */
async function openDialog(page) {
  // The dialog uses a closed shadow root on purpose. Playwright cannot see into
  // one, so the test opens it. Nothing else about the dialog changes.
  await page.setContent("<body><h1>Page</h1></body>");
  await page.evaluate(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
  await page.evaluate(`window.__result = undefined; (${FN})(${JSON.stringify(OPTS)}).then((v) => { window.__result = v; }); undefined;`);
}

for (const scheme of /** @type {const} */ (["light", "dark"])) {
  test(`dialog follows the ${scheme} scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await openDialog(page);
    const scrub = page.getByRole("button", { name: "Scrub" });
    await expect(scrub).toBeVisible();
    // Red appears only on the destructive button.
    await expect(scrub).toHaveCSS("background-color", "rgb(215, 0, 21)");
    await expect(page.getByRole("button", { name: "Cancel" })).not.toHaveCSS("background-color", "rgb(215, 0, 21)");
    // The card takes the ground of the scheme.
    await expect(page.getByRole("dialog").locator("div").first()).toHaveCSS(
      "background-color",
      scheme === "dark" ? "rgb(28, 28, 30)" : "rgb(255, 255, 255)"
    );
  });
}

test("Cancel resolves false and removes the dialog", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDialog(page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => page.evaluate("window.__result")).toBe(false);
  await expect(page.locator("#__wash_dialog__")).toHaveCount(0);
});

test("Escape dismisses with the dismiss value", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDialog(page);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate("window.__result")).toBe(false);
});

test("Scrub resolves true on a real click", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDialog(page);
  await page.getByRole("button", { name: "Scrub" }).click();
  await expect.poll(() => page.evaluate("window.__result")).toBe(true);
});
