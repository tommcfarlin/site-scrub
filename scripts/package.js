// @ts-check
// Build dist/site-scrub-<version>.zip with the system zip command.
// Usage: npm run package
// Publishes nothing. See RELEASING.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectFiles, findMissingReferences, findUnshippedImports } from "./package-lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} dir @returns {string[]} File names (not folders) in dir. */
const filesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

/** @param {string} message */
function fail(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const version = manifest.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`manifest.json has no valid version (got ${JSON.stringify(version)}).`);
}

const rootFiles = filesIn(root);
const files = selectFiles(rootFiles, filesIn(path.join(root, "icons")));

const missing = findMissingReferences(files, manifest, readFileSync(path.join(root, "options.html"), "utf8"));
if (missing.length > 0) fail(`files referenced by manifest.json or options.html are missing from the zip:\n  ${missing.join("\n  ")}`);

/** @type {Record<string, string>} */
const sources = {};
for (const f of files.filter((name) => name.endsWith(".js"))) sources[f] = readFileSync(path.join(root, f), "utf8");
const unshipped = findUnshippedImports(files, sources, rootFiles.filter((f) => f.endsWith(".js")));
if (unshipped.length > 0) fail(`shipped files import files that would not ship:\n  ${unshipped.join("\n  ")}`);

const dist = path.join(root, "dist");
const zipPath = path.join(dist, `site-scrub-${version}.zip`);
mkdirSync(dist, { recursive: true });
rmSync(zipPath, { force: true });
try {
  // -X drops extra file attributes; -q keeps the output quiet.
  execFileSync("zip", ["-X", "-q", zipPath, ...files], { cwd: root, stdio: "inherit" });
} catch (err) {
  fail(`the zip command failed: ${err instanceof Error ? err.message : String(err)}`);
}
console.log(`Wrote ${path.relative(root, zipPath)} (${files.length} files)`);
