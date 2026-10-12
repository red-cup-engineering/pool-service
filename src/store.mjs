/**
 * `store` — this package's own small persisted-document helper: read-or-default and
 * atomic-write for the one JSON document each pool keeps (`{pool, tallies, draws}`).
 * Not a generic filesystem primitive; a pool's document has no EAVT row shape of its
 * own yet, so this stays local rather than routing through a house fs service.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cachedRoot;

/**
 * This package's own root directory (the directory holding its `package.json`), for a script
 * that needs a default path under its own `data/` (the tips section's `packageRoot` in
 * `src/tips.mjs` is the sibling pattern this follows).
 * @returns {string} Absolute path to this package's root.
 */
export function packageRoot() {
  if (cachedRoot === undefined) cachedRoot = dirname(fileURLToPath(import.meta.url).replace(/\/src\/store\.mjs$/u, "/package.json"));
  return cachedRoot;
}

/**
 * Reads a pool's persisted JSON document, or returns `fallback` when the file is absent.
 * @param {string} path Absolute or relative path to the pool's state file.
 * @param {object} fallback The document to return when nothing is persisted yet.
 * @returns {object} The parsed document, or `fallback`.
 */
export function readStore(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Writes a pool's document back to `path`, creating its parent directory when absent.
 * @param {string} path Absolute or relative path to the pool's state file.
 * @param {object} document The document to persist, pretty-printed.
 * @returns {void}
 */
export function writeStore(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
