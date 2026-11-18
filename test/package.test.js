// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFiles, findMissingReferences, findUnshippedImports } from "../scripts/package-lib.js";

const ROOT = [
  "background.js", "playwright.config.js", "manifest.json", "options.html", "options.css",
  "package.json", "README.md", "tsconfig.json", ".gitignore", "psl-data.js", "ARCHITECTURE.md",
  "INSTALL.txt", "LICENSE",
];

test("selectFiles keeps root js files, manifest, options page, and icons", () => {
  const files = selectFiles(ROOT, ["icon16.png", "icon128.png"]);
  assert.deepEqual(files, [
    "INSTALL.txt", "LICENSE", "background.js", "icons/icon128.png", "icons/icon16.png",
    "manifest.json", "options.css", "options.html", "psl-data.js",
  ]);
});

test("selectFiles drops playwright.config.js and non-shipped files", () => {
  const files = selectFiles(ROOT, []);
  for (const bad of ["playwright.config.js", "package.json", "README.md", "tsconfig.json", ".gitignore"]) {
    assert.ok(!files.includes(bad), bad);
  }
});

const MANIFEST = {
  background: { service_worker: "background.js" },
  options_ui: { page: "options.html" },
  action: { default_icon: { 16: "icons/icon16.png" } },
  icons: { 16: "icons/icon16.png", 128: "icons/icon128.png" },
};
const HTML = '<link rel="stylesheet" href="options.css" /><script type="module" src="options.js"></script>' +
  '<a href="https://pressware.co/x">x</a>';

test("findMissingReferences reports nothing when every reference ships", () => {
  const files = ["background.js", "options.html", "options.css", "options.js", "icons/icon16.png", "icons/icon128.png"];
  assert.deepEqual(findMissingReferences(files, MANIFEST, HTML), []);
});

test("findMissingReferences names each missing file once", () => {
  const files = ["options.html", "icons/icon16.png"];
  assert.deepEqual(findMissingReferences(files, MANIFEST, HTML), [
    "background.js", "icons/icon128.png", "options.css", "options.js",
  ]);
});

test("findUnshippedImports finds root imports that are not shipped", () => {
  const sources = {
    "background.js": 'import { a } from "./lib.js";\nimport { b } from "./extra.js";',
    "lib.js": 'export const a = 1; // import("./other.js")',
  };
  const shipped = ["background.js", "lib.js"];
  assert.deepEqual(findUnshippedImports(shipped, sources, ["extra.js", "other.js", "lib.js"]), [
    "extra.js (imported by background.js)",
    "other.js (imported by lib.js)",
  ]);
});

test("findUnshippedImports ignores imports that ship", () => {
  const sources = { "a.js": 'import "./b.js";' };
  assert.deepEqual(findUnshippedImports(["a.js", "b.js"], sources, ["a.js", "b.js"]), []);
});
