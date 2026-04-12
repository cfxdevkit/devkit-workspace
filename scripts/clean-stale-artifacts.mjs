#!/usr/bin/env node
/**
 * clean-stale-artifacts.mjs
 *
 * Removes stale JS/declaration files produced by tsc that no longer have a
 * corresponding TypeScript source file.
 *
 * Two modes:
 *  1. In-place builds (e.g. packages/ui-shared) - .js, .d.ts, .d.ts.map next
 *     to .ts/.tsx sources in src/.
 *  2. outDir builds (e.g. packages/mcp-server -> dist/) - .js, .d.ts, .d.ts.map
 *     in the output dir whose relative .ts/.tsx source no longer exists.
 *
 * Usage:
 *   node scripts/clean-stale-artifacts.mjs           # dry-run (default)
 *   node scripts/clean-stale-artifacts.mjs --delete  # actually delete files
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const dryRun = !process.argv.includes('--delete');

const EMITTED_EXTS = ['.js', '.js.map', '.d.ts', '.d.ts.map'];
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts'];
const SKIP_BASENAMES = new Set(['vite-env.d.ts']);

const IN_PLACE_PACKAGES = [
  { srcDir: 'packages/ui-shared/src' },
];

const OUT_DIR_PACKAGES = [
  { srcDir: 'packages/mcp-server/src', outDir: 'packages/mcp-server/dist' },
  { srcDir: 'packages/shared/src', outDir: 'packages/shared/dist' },
  { srcDir: 'packages/vscode-extension/src', outDir: 'packages/vscode-extension/out' },
  { srcDir: 'packages/workspace-cli/src', outDir: 'packages/workspace-cli/dist' },
];

function walkDir(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkDir(full, list);
    } else {
      list.push(full);
    }
  }
  return list;
}

function emittedStem(filePath) {
  for (const ext of EMITTED_EXTS) {
    if (filePath.endsWith(ext)) return filePath.slice(0, -ext.length);
  }
  return null;
}

function hasSource(stem) {
  return SOURCE_EXTS.some((ext) => fs.existsSync(stem + ext));
}

let staleCount = 0;

for (const { srcDir } of IN_PLACE_PACKAGES) {
  const absDir = path.resolve(ROOT, srcDir);
  const files = walkDir(absDir);
  for (const file of files) {
    if (SKIP_BASENAMES.has(path.basename(file))) continue;
    const stem = emittedStem(file);
    if (!stem) continue;
    if (!hasSource(stem)) {
      staleCount++;
      const rel = path.relative(ROOT, file);
      if (dryRun) {
        console.log(`[stale] ${rel}`);
      } else {
        fs.unlinkSync(file);
        console.log(`[deleted] ${rel}`);
      }
    }
  }
}

for (const { srcDir, outDir } of OUT_DIR_PACKAGES) {
  const absSrc = path.resolve(ROOT, srcDir);
  const absOut = path.resolve(ROOT, outDir);
  if (!fs.existsSync(absOut)) continue;

  const files = walkDir(absOut);
  for (const file of files) {
    const stem = emittedStem(file);
    if (!stem) continue;

    const relStem = path.relative(absOut, stem);
    const srcStem = path.join(absSrc, relStem);
    const srcParent = path.dirname(srcStem);
    if (!fs.existsSync(srcParent)) continue;

    if (!hasSource(srcStem)) {
      staleCount++;
      const rel = path.relative(ROOT, file);
      if (dryRun) {
        console.log(`[stale] ${rel}`);
      } else {
        fs.unlinkSync(file);
        console.log(`[deleted] ${rel}`);
      }
    }
  }
}

if (staleCount === 0) {
  console.log('No stale artifacts found.');
} else if (dryRun) {
  console.log(`\nFound ${staleCount} stale file(s). Run with --delete to remove them.`);
} else {
  console.log(`\nRemoved ${staleCount} stale file(s).`);
}
