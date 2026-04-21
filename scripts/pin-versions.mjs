#!/usr/bin/env node
/**
 * Rewrite every workspace package.json so dependency ranges are EXACT versions
 * (drop `^` and `~`). Values are pulled from the currently-installed copies in
 * node_modules. Workspace-internal refs stay as `"*"` so local linking works.
 *
 * Usage:
 *   node scripts/pin-versions.mjs          # pin in-place
 *   node scripts/pin-versions.mjs --check  # fail (exit 1) if anything unpinned
 *
 * Re-run after any intentional upgrade (`npm install <pkg>@latest` etc.).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
  "package.json",
  "ai/package.json",
  "agent/package.json",
  "tui/package.json",
  "app/package.json",
  "docs/package.json",
];
const CHECK_ONLY = process.argv.includes("--check");

// Collect names of internal workspaces — these stay as "*".
const WORKSPACE_NAMES = new Set();
for (const m of MANIFESTS) {
  const p = join(ROOT, m);
  if (!existsSync(p)) continue;
  try {
    const pkg = JSON.parse(readFileSync(p, "utf-8"));
    if (pkg.name) WORKSPACE_NAMES.add(pkg.name);
  } catch {}
}

function installedVersion(depName) {
  // Walk upward from each manifest looking for the installed package.
  const candidates = [join(ROOT, "node_modules", depName, "package.json")];
  for (const m of MANIFESTS) {
    candidates.push(join(ROOT, dirname(m), "node_modules", depName, "package.json"));
  }
  for (const c of candidates) {
    if (existsSync(c)) {
      try { return JSON.parse(readFileSync(c, "utf-8")).version; } catch {}
    }
  }
  return null;
}

function detectIndent(text) {
  const m = text.match(/\n([\t ]+)"/);
  return m ? m[1] : "  ";
}

function pinDeps(deps, manifestLabel, missing) {
  if (!deps) return 0;
  let changed = 0;
  for (const [name, range] of Object.entries(deps)) {
    if (WORKSPACE_NAMES.has(name)) {
      if (range !== "*") { deps[name] = "*"; changed++; }
      continue;
    }
    // Already exact (pure semver)?
    if (/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.+-]+)?$/.test(range)) continue;
    const v = installedVersion(name);
    if (!v) { missing.push(`${manifestLabel}:${name} (${range})`); continue; }
    if (deps[name] !== v) { deps[name] = v; changed++; }
  }
  return changed;
}

let totalChanged = 0;
const missing = [];
const touched = [];

for (const m of MANIFESTS) {
  const p = join(ROOT, m);
  if (!existsSync(p)) continue;
  const raw = readFileSync(p, "utf-8");
  const indent = detectIndent(raw);
  const pkg = JSON.parse(raw);
  const changed =
    pinDeps(pkg.dependencies, m, missing) +
    pinDeps(pkg.devDependencies, m, missing) +
    pinDeps(pkg.optionalDependencies, m, missing) +
    pinDeps(pkg.peerDependencies, m, missing);
  if (changed > 0) {
    totalChanged += changed;
    touched.push(`${m} (${changed})`);
    if (!CHECK_ONLY) {
      const endsWithNewline = raw.endsWith("\n");
      writeFileSync(p, JSON.stringify(pkg, null, indent) + (endsWithNewline ? "\n" : ""));
    }
  }
}

if (CHECK_ONLY) {
  if (totalChanged > 0) {
    console.error(`unpinned ranges still present: ${touched.join(", ")}`);
    process.exit(1);
  }
  console.log("all dependency ranges are pinned ✓");
  process.exit(0);
}

console.log(totalChanged > 0 ? `pinned ${totalChanged} dep(s): ${touched.join(", ")}` : "nothing to pin");
if (missing.length) {
  console.warn(`could not pin (not installed — run npm install first):\n  ${missing.join("\n  ")}`);
  process.exit(missing.length ? 2 : 0);
}
