// @ts-check
// Pure parts of the release packaging: which files ship, and the checks that
// stop a broken zip. No file system or zip use here, so tests run without them.

/** Root JavaScript files that never ship. */
const NOT_SHIPPED_JS = new Set(["playwright.config.js"]);

/** Root files that always ship besides the JavaScript files. */
const SHIPPED_STATIC = ["manifest.json", "options.html", "options.css", "INSTALL.txt", "LICENSE"];

/**
 * The files the zip holds, as sorted zip paths.
 * Rule: root *.js except playwright.config.js, plus manifest.json,
 * options.html, options.css, INSTALL.txt, LICENSE, and everything in icons/.
 * @param {string[]} rootFiles File names at the repository root.
 * @param {string[]} iconFiles File names inside icons/.
 * @returns {string[]}
 */
export function selectFiles(rootFiles, iconFiles) {
  const root = rootFiles.filter(
    (f) => (f.endsWith(".js") && !NOT_SHIPPED_JS.has(f)) || SHIPPED_STATIC.includes(f)
  );
  return [...root, ...iconFiles.map((f) => `icons/${f}`)].sort();
}

/**
 * Local files that the manifest and the options page point to, as zip paths.
 * @param {Record<string, any>} manifest
 * @param {string} optionsHtml
 * @returns {string[]}
 */
function referencedFiles(manifest, optionsHtml) {
  /** @type {Set<string>} */
  const refs = new Set();
  /** @param {unknown} value */
  const add = (value) => {
    if (typeof value === "string" && value) refs.add(value);
  };
  add(manifest.background?.service_worker);
  add(manifest.options_ui?.page);
  add(manifest.options_page);
  add(manifest.action?.default_popup);
  for (const group of [manifest.icons, manifest.action?.default_icon]) {
    if (group && typeof group === "object") Object.values(group).forEach(add);
  }
  for (const m of optionsHtml.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
    if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(m[1])) refs.add(m[1].replace(/^\.\//, ""));
  }
  return [...refs];
}

/**
 * Referenced files that are not in the zip, sorted, without duplicates.
 * @param {string[]} files Zip paths.
 * @param {Record<string, any>} manifest
 * @param {string} optionsHtml
 * @returns {string[]}
 */
export function findMissingReferences(files, manifest, optionsHtml) {
  const have = new Set(files);
  return referencedFiles(manifest, optionsHtml).filter((f) => !have.has(f)).sort();
}

/**
 * Root JavaScript files that a shipped file imports but the zip lacks.
 * @param {string[]} shipped Zip paths.
 * @param {Record<string, string>} sources Source text by zip path.
 * @param {string[]} rootJsFiles Every *.js file at the repository root.
 * @returns {string[]} Lines like "extra.js (imported by background.js)".
 */
export function findUnshippedImports(shipped, sources, rootJsFiles) {
  const have = new Set(shipped);
  const root = new Set(rootJsFiles);
  /** @type {string[]} */
  const out = [];
  for (const file of shipped.filter((f) => f.endsWith(".js")).sort()) {
    const text = sources[file] ?? "";
    for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']\.\/([^"'/]+\.js)["']/g)) {
      const target = m[1];
      if (root.has(target) && !have.has(target)) out.push(`${target} (imported by ${file})`);
    }
  }
  return [...new Set(out)].sort();
}
