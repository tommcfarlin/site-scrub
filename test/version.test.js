// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, compareVersions } from "../version.js";

test("parseVersion reads strict major.minor.patch", () => {
  assert.deepEqual(parseVersion("1.0.0"), [1, 0, 0]);
  assert.deepEqual(parseVersion("10.20.30"), [10, 20, 30]);
});

test("parseVersion rejects anything else", () => {
  for (const bad of ["v2", "1.x", "1.0", "1.0.0-beta", "", " 1.0.0", "1.0.0.0", "v1.0.0", "1.0.0\n"]) {
    assert.equal(parseVersion(bad), null, JSON.stringify(bad));
  }
});

test("compareVersions orders numerically", () => {
  assert.equal(compareVersions("1.1.0", "1.0.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.9.0", "1.10.0"), -1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});

test("compareVersions returns 0 when either side is invalid", () => {
  assert.equal(compareVersions("junk", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "v2"), 0);
  assert.equal(compareVersions("", ""), 0);
});
