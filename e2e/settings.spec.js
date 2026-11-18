// @ts-check
// End-to-end tests for the settings page (options.html), run against the real
// unpacked extension in Chromium. History is seeded per test in a fresh profile.

import { test, expect } from "./fixtures.js";

// 5 registrable domains. facebook.com and reddit.com are default domains, so
// they start ticked on first open (no "domains" key stored yet).
const HISTORY = [
  "https://apple.com/iphone",
  "https://support.apple.com/help",
  "https://news.bbc.co.uk/story",
  "https://example.org/",
  "https://facebook.com/a",
  "https://facebook.com/b",
  "https://www.facebook.com/1",
  "https://www.facebook.com/2",
  "https://www.facebook.com/3",
  "https://work.facebook.com/1",
  "https://work.facebook.com/2",
  "https://m.facebook.com/1",
  "https://www.reddit.com/r/1",
  "https://www.reddit.com/r/2",
];

/** @param {import("@playwright/test").Page} page */
const rows = (page) => page.locator(".row[data-domain]");

/** @param {import("@playwright/test").Page} page @param {string} domain */
const row = (page, domain) => page.locator(`.row[data-domain="${domain}"]`);

/**
 * @param {import("@playwright/test").Worker} sw
 * @param {string} key
 */
const stored = (sw, key) =>
  sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

test.beforeEach(async ({ seedHistory }) => {
  await seedHistory(HISTORY);
});

test("lists domains alphabetically with item counts", async ({ openSettings }) => {
  const page = await openSettings();
  await expect(rows(page).locator(".t")).toHaveText([
    "apple.com",
    "bbc.co.uk",
    "example.org",
    "facebook.com",
    "reddit.com",
  ]);
  await expect(rows(page).locator(".num")).toHaveText([
    "2 items",
    "1 item",
    "1 item",
    "8 items",
    "2 items",
  ]);
  await expect(row(page, "facebook.com").locator(".s")).toHaveText("3 subdomains");
  await expect(row(page, "apple.com").locator(".s")).toHaveText("1 subdomain");
  await expect(row(page, "example.org").locator(".s")).toHaveText("No subdomains");
  // Defaults present in history start ticked.
  await expect(page.getByRole("switch", { name: "Scrub facebook.com" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Scrub reddit.com" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Scrub apple.com" })).not.toBeChecked();
  await expect(page.locator("#summary")).toHaveText("2 sites · 10 items");
});

test("turning a domain on saves it and updates the summary", async ({ openSettings, serviceWorker }) => {
  const page = await openSettings();
  const sw = page.getByRole("switch", { name: "Scrub apple.com" });
  await sw.click();
  await expect(sw).toBeChecked();
  await expect(page.locator("#summary")).toHaveText("3 sites · 12 items");
  await expect
    .poll(() => stored(serviceWorker, "domains"))
    .toEqual(expect.arrayContaining(["apple.com", "facebook.com", "reddit.com"]));

  // And off again.
  await page.getByRole("switch", { name: "Scrub facebook.com" }).click();
  await expect(page.locator("#summary")).toHaveText("2 sites · 4 items");
  await expect
    .poll(async () => /** @type {string[]} */ (await stored(serviceWorker, "domains")).includes("facebook.com"))
    .toBe(false);
});

test("expanding facebook.com shows its subdomains with Keep switches", async ({ openSettings }) => {
  const page = await openSettings();
  const chev = row(page, "facebook.com").getByRole("button", { name: /subdomains of facebook\.com/ });
  await expect(chev).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("switch", { name: "Keep work.facebook.com" })).toBeHidden();

  await chev.click();
  await expect(chev).toHaveAttribute("aria-expanded", "true");
  for (const host of ["m.facebook.com", "work.facebook.com", "www.facebook.com"]) {
    const keep = page.getByRole("switch", { name: `Keep ${host}` });
    await expect(keep).toBeVisible();
    await expect(keep).not.toBeChecked();
  }

  await chev.click();
  await expect(chev).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("switch", { name: "Keep work.facebook.com" })).toBeHidden();
});

test("Keep on work.facebook.com lowers the facebook.com count", async ({ openSettings, serviceWorker }) => {
  const page = await openSettings();
  await row(page, "facebook.com").getByRole("button", { name: /subdomains of facebook\.com/ }).click();
  await page.getByRole("switch", { name: "Keep work.facebook.com" }).click();

  await expect(row(page, "facebook.com").locator(".num")).toHaveText("6 items");
  await expect(row(page, "facebook.com").locator(".s")).toHaveText("3 subdomains · 1 kept");
  await expect(page.locator("#summary")).toHaveText("2 sites · 8 items");
  await expect.poll(() => stored(serviceWorker, "kept")).toEqual(["work.facebook.com"]);

  // Survives a reload.
  await page.reload();
  await expect(row(page, "facebook.com").locator(".num")).toHaveText("6 items");
});

test("search narrows the list", async ({ openSettings }) => {
  const page = await openSettings();
  const search = page.getByRole("searchbox", { name: "Search sites" });
  await expect(rows(page)).toHaveCount(5);

  await search.fill("bbc");
  await expect(rows(page).filter({ visible: true }).locator(".t")).toHaveText(["bbc.co.uk"]);

  // Matches a subdomain too.
  await search.fill("work.");
  await expect(rows(page).filter({ visible: true }).locator(".t")).toHaveText(["facebook.com"]);

  await search.fill("nothing-matches-this");
  await expect(rows(page).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("No sites match")).toBeVisible();

  await search.fill("");
  await expect(rows(page).filter({ visible: true })).toHaveCount(5);
});

test("every switch has an accessible name", async ({ openSettings }) => {
  const page = await openSettings();
  await expect(rows(page)).toHaveCount(5);
  const switches = page.getByRole("switch");
  await expect(switches.filter({ visible: true })).toHaveCount(await rows(page).count());
  for (const sw of await switches.filter({ visible: true }).all()) {
    await expect(sw).toHaveAccessibleName(/^Scrub \S+$/);
  }
});

test("dark scheme uses the dark ground color", async ({ openSettings }) => {
  const page = await openSettings();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(rows(page)).toHaveCount(5);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(0, 0, 0)");

  await page.emulateMedia({ colorScheme: "light" });
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(light).toBe("rgb(245, 245, 247)");
});

test("the extension id is fixed by the manifest key", async ({ extensionId }) => {
  expect(extensionId).toBe("okelcjddfojjpngggcankijeagakaegf");
});

// ---- Advanced: also remove cookies, cache, and site storage ---------------

/**
 * Replace chrome.permissions.request on the settings page. A real permission
 * prompt cannot be answered in headless Chromium.
 * @param {import("@playwright/test").Page} page
 * @param {boolean} granted
 */
const stubPermissionRequest = (page, granted) =>
  page.evaluate((g) => {
    /** @type {any} */ (window).__permissionRequests = [];
    chrome.permissions.request = /** @type {any} */ (async (/** @type {any} */ p) => {
      /** @type {any} */ (window).__permissionRequests.push(p);
      return g;
    });
  }, granted);

/** @param {import("@playwright/test").Page} page */
const advancedToggle = (page) => page.getByRole("tab", { name: "Advanced" });

test("Advanced is its own tab, and Sites shows first", async ({ openSettings }) => {
  const page = await openSettings();
  const tab = advancedToggle(page);
  await expect(tab).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("switch", { name: "Also remove cookies" })).toBeHidden();
  await expect(page.getByText("History is always removed.")).toBeHidden();

  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeHidden();
  for (const name of ["Also remove cookies", "Also remove cached files", "Also remove site storage"]) {
    const sw = page.getByRole("switch", { name });
    await expect(sw).toBeVisible();
    await expect(sw).not.toBeChecked();
  }
  await expect(page.getByText("History is always removed.")).toBeVisible();

  await page.getByRole("tab", { name: "Sites" }).click();
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Also remove cookies" })).toBeHidden();
});

test("turning on cookies after a granted permission saves alsoRemove", async ({ openSettings, serviceWorker }) => {
  const page = await openSettings();
  await stubPermissionRequest(page, true);
  await advancedToggle(page).click();

  const cookies = page.getByRole("switch", { name: "Also remove cookies" });
  await cookies.click();
  await expect(cookies).toBeChecked();
  await expect
    .poll(() => stored(serviceWorker, "alsoRemove"))
    .toEqual({ cookies: true, cache: false, storage: false });
  expect(await page.evaluate(() => /** @type {any} */ (window).__permissionRequests))
    .toEqual([{ permissions: ["browsingData"] }]);

  // A second type keeps the first (alsoRemove is saved whole).
  await page.getByRole("switch", { name: "Also remove site storage" }).click();
  await expect
    .poll(() => stored(serviceWorker, "alsoRemove"))
    .toEqual({ cookies: true, cache: false, storage: true });

  // Turning one off saves without asking again.
  await cookies.click();
  await expect(cookies).not.toBeChecked();
  await expect
    .poll(() => stored(serviceWorker, "alsoRemove"))
    .toEqual({ cookies: false, cache: false, storage: true });
  expect(await page.evaluate(() => /** @type {any} */ (window).__permissionRequests.length)).toBe(2);

  // Survives a reload.
  await page.reload();
  await advancedToggle(page).click();
  await expect(page.getByRole("switch", { name: "Also remove site storage" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Also remove cookies" })).not.toBeChecked();
});

test("denied permission leaves the switch off and saves nothing", async ({ openSettings, serviceWorker }) => {
  const page = await openSettings();
  await stubPermissionRequest(page, false);
  await advancedToggle(page).click();

  const cookies = page.getByRole("switch", { name: "Also remove cookies" });
  await cookies.click();
  await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__permissionRequests.length)).toBe(1);
  await expect(cookies).not.toBeChecked();
  // Give any stray write time to land, then check that nothing was stored.
  await page.waitForTimeout(400);
  expect(await stored(serviceWorker, "alsoRemove")).toBeUndefined();
});

// ---- update banner -------------------------------------------------------

/** @param {import("@playwright/test").Worker} sw @param {Record<string, unknown>} items */
const seed = (sw, items) => sw.evaluate((o) => chrome.storage.local.set(o), items);

test("banner for a newer version", async ({ openSettings, serviceWorker }) => {
  await seed(serviceWorker, { latestVersion: "9.9.9" });
  const page = await openSettings();
  const banner = page.locator("#update-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Version 9.9.9 is available");
  await expect(banner).toContainText("Download it, replace your Site Scrub folder, then reload the extension.");
  const download = banner.getByRole("link", { name: "Download" });
  await expect(download).toHaveAttribute("href", "https://pressware.co/extensions/site-scrub/");
  await expect(download).toHaveAttribute("target", "_blank");
  await expect(download).toHaveAttribute("rel", "noopener noreferrer");

  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toBeHidden();
  await expect.poll(() => stored(serviceWorker, "dismissedVersion")).toBe("9.9.9");

  // Stays hidden after a reload...
  await page.reload();
  await expect(page.locator("#summary")).not.toBeEmpty();
  await expect(banner).toBeHidden();

  // ...until a still-newer version appears.
  await seed(serviceWorker, { latestVersion: "9.9.10" });
  await page.reload();
  await expect(banner).toContainText("Version 9.9.10 is available");
});

test("no banner when latestVersion equals the running version", async ({ openSettings, serviceWorker }) => {
  await seed(serviceWorker, { latestVersion: "1.0.0" });
  const page = await openSettings();
  await expect(page.locator("#summary")).not.toBeEmpty();
  await expect(page.locator("#update-banner")).toBeHidden();
});

test("turning off Check for updates hides the banner", async ({ openSettings, serviceWorker }) => {
  await seed(serviceWorker, { latestVersion: "9.9.9" });
  const page = await openSettings();
  const banner = page.locator("#update-banner");
  await expect(banner).toBeVisible();
  await advancedToggle(page).click();
  const sw = page.getByRole("switch", { name: "Check for updates" });
  await expect(sw).toBeChecked();
  await expect(page.getByText("Once a day, Site Scrub reads one version number from pressware.co. Nothing about you is sent.")).toBeVisible();
  await sw.click();
  await expect(banner).toBeHidden();
  await expect.poll(() => stored(serviceWorker, "updateCheck")).toBe(false);

  // Off stays off after a reload, and the banner stays hidden.
  await page.reload();
  await advancedToggle(page).click();
  await expect(page.getByRole("switch", { name: "Check for updates" })).not.toBeChecked();
  await expect(banner).toBeHidden();

  // Back on: the banner returns.
  await page.getByRole("switch", { name: "Check for updates" }).click();
  await expect(banner).toBeVisible();
});
