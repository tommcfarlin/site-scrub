// @ts-check
// Update check: once a day, read one version number from pressware.co. The
// request carries no identifier and no data about the user. Failures are silent.

import { compareVersions, parseVersion } from "./version.js";
import { loadSettings, saveSettings } from "./settings.js";

export const VERSION_URL = "https://pressware.co/extensions/site-scrub/version.json";
export const ALARM_NAME = "site-scrub-update-check";
const BADGE_TEXT = "•";
const BADGE_COLOR = "#0071E3";

/**
 * Returns the published version when it is newer than the running one, else null.
 * @param {string} currentVersion
 * @param {typeof fetch} fetchFn
 * @returns {Promise<string | null>}
 */
export async function checkForUpdate(currentVersion, fetchFn) {
  try {
    const res = await fetchFn(VERSION_URL, { cache: "no-store", credentials: "omit" });
    if (!res.ok) return null;
    const data = await res.json();
    const version = data !== null && typeof data === "object" ? data.version : undefined;
    if (typeof version !== "string" || parseVersion(version) === null) return null;
    return compareVersions(version, currentVersion) === 1 ? version : null;
  } catch {
    return null;
  }
}

/**
 * Show the toolbar badge only while updates are on and a newer version is stored.
 * @returns {Promise<void>}
 */
export async function syncBadge() {
  const { updateCheck, latestVersion } = await loadSettings();
  const newer = updateCheck && latestVersion !== null &&
    compareVersions(latestVersion, chrome.runtime.getManifest().version) === 1;
  if (newer) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setBadgeText({ text: BADGE_TEXT });
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

/**
 * @param {{ name: string }} alarm
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<void>}
 */
export async function handleUpdateAlarm(alarm, fetchFn = fetch) {
  if (alarm.name !== ALARM_NAME) return;
  const settings = await loadSettings();
  if (settings.updateCheck) {
    const newer = await checkForUpdate(chrome.runtime.getManifest().version, fetchFn);
    if (newer !== null) await saveSettings({ latestVersion: newer });
  }
  await syncBadge();
}

/** Create the daily alarm unless it already exists. @returns {Promise<void>} */
export async function registerUpdateAlarm() {
  if (await chrome.alarms.get(ALARM_NAME)) return;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1440 });
}
