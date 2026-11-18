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
  await expect(switches).toHaveCount(await rows(page).count());
  for (const sw of await switches.all()) {
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
