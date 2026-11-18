// @ts-check
// Checks on manifest.json that the code cannot enforce by itself.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

/** The extension id that Chrome derives from a base64 DER public key. */
function idFromKey(/** @type {string} */ key) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

test("a fixed key gives every install the same extension id", () => {
  assert.equal(typeof manifest.key, "string");
  assert.match(manifest.key, /^[A-Za-z0-9+/]+=*$/, "one line of base64, no PEM headers");
  assert.equal(idFromKey(manifest.key), "okelcjddfojjpngggcankijeagakaegf");
});

test("minimum_chrome_version covers storage.session", () => {
  assert.equal(manifest.minimum_chrome_version, "102");
});
