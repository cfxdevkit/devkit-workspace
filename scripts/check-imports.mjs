#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const packagesRoot = resolve(root, 'packages');

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.generated',
  'artifacts',
  'hh-artifacts',
  'hh-cache',
  'typechain-types',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

const PACKAGE_BOUNDARY_RULES = [
  {
    from: 'packages/workspace-cli',
    forbidden: ['packages/mcp-server', 'packages/vscode-extension'],
    reason: 'workspace-cli must remain a launcher and must not depend on orchestration layers',
  },
  {
    from: 'packages/mcp-server',
    forbidden: ['packages/vscode-extension'],
    reason: 'mcp-server must not depend on vscode-extension',
  },
  {
    from: 'packages/vscode-extension',
    forbidden: ['packages/mcp-server'],
    reason: 'vscode-extension must not depend on mcp-server',
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectWorkspacePackages() {
  const out = new Map();

  for (const entry of readdirSync(packagesRoot)) {
    const abs = join(packagesRoot, entry);
    if (!statSync(abs).isDirectory()) continue;

    const pkgPath = join(abs, 'package.json');
    if (!existsSync(pkgPath)) continue;

    const pkg = readJson(pkgPath);
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) continue;

    out.set(pkg.name, {
      name: pkg.name,
      dirAbs: abs,
      dirRel: relative(root, abs).replaceAll('\\', '/'),
    });
  }

  return out;
}

function walkFiles(dir, files) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);

    if (st.isDirectory()) {
      if (IGNORED_DIRS.has(entry)) continue;
      walkFiles(abs, files);
      continue;
    }

    const ext = entry.slice(entry.lastIndexOf('.'));
    if (SOURCE_EXT.has(ext)) {
      files.push(abs);
    }
  }
}

function extractSpecifiers(code) {
  const specs = [];
  const esmRe = /(?:import|export)\s+(?:[^'"`]*?\sfrom\s*)?["']([^"']+)["']/g;
  const dynRe = /import\(\s*["']([^"']+)["']\s*\)/g;

  let match = esmRe.exec(code);
  while (match !== null) {
    specs.push(match[1]);
    match = esmRe.exec(code);
  }

  match = dynRe.exec(code);
  while (match !== null) {
    specs.push(match[1]);
    match = dynRe.exec(code);
  }

  return specs;
}

function packageForFile(fileAbs, pkgByDirAbs) {
  for (const pkg of pkgByDirAbs.values()) {
    if (fileAbs === pkg.dirAbs || fileAbs.startsWith(`${pkg.dirAbs}/`)) {
      return pkg;
    }
  }
  return null;
}

function normalizeImportTarget(spec, fileAbs) {
  if (!spec.startsWith('.')) return null;
  return resolve(dirname(fileAbs), spec);
}

function lineForSpecifier(code, spec) {
  const idx = code.indexOf(spec);
  if (idx < 0) return 1;
  return code.slice(0, idx).split('\n').length;
}

function main() {
  if (!existsSync(packagesRoot)) {
    console.error('[imports] packages/ directory not found');
    process.exit(1);
  }

  const workspacePkgs = collectWorkspacePackages();
  const pkgByDirAbs = new Map([...workspacePkgs.values()].map((pkg) => [pkg.dirAbs, pkg]));

  const files = [];
  walkFiles(packagesRoot, files);

  const errors = [];

  for (const fileAbs of files) {
    // Local package build scripts may need to call root tooling by relative path.
    // Boundary rules target runtime/source modules, not package script glue.
    if (fileAbs.includes('/scripts/')) {
      continue;
    }

    const ownerPkg = packageForFile(fileAbs, pkgByDirAbs);
    if (!ownerPkg) continue;

    const code = readFileSync(fileAbs, 'utf8');
    const specs = extractSpecifiers(code);

    for (const spec of specs) {
      const line = lineForSpecifier(code, spec);
      const relFile = relative(root, fileAbs).replaceAll('\\', '/');

      // Rule 0: MCP entrypoints must use the DEX feature boundary only.
      // This keeps domain internals out of top-level orchestration files.
      if (
        (relFile === 'packages/mcp-server/src/server.ts' ||
          relFile === 'packages/mcp-server/src/orchestration/conflux-lifecycle.ts') &&
        /(^\.\/dex-|^\.\.\/dex-|^\.\/features\/dex\/dex-)/.test(spec)
      ) {
        errors.push({
          file: relFile,
          line,
          rule: 'mcp-dex-feature-boundary',
          message:
            `Import '${spec}' bypasses DEX feature boundary. ` +
            `Use './features/dex/dex.js' (or '../features/dex/dex.js' in orchestration) instead.`,
        });
      }

      // Rule 1: Prevent relative imports that escape package root.
      if (spec.startsWith('.')) {
        const targetAbs = normalizeImportTarget(spec, fileAbs);
        if (targetAbs && !targetAbs.startsWith(`${ownerPkg.dirAbs}/`)) {
          errors.push({
            file: relFile,
            line,
            rule: 'no-cross-package-relative-import',
            message: `Relative import escapes package root: '${spec}'`,
          });
        }
      }

      // Rule 2: Prevent deep imports into workspace package internals.
      for (const pkg of workspacePkgs.values()) {
        if (spec === pkg.name) continue;
        if (spec.startsWith(`${pkg.name}/`)) {
          errors.push({
            file: relFile,
            line,
            rule: 'no-workspace-deep-import',
            message: `Deep import into workspace package internals is forbidden: '${spec}'`,
          });
        }
      }

      // Rule 3: Directed dependency boundaries.
      for (const boundary of PACKAGE_BOUNDARY_RULES) {
        if (ownerPkg.dirRel !== boundary.from) continue;

        for (const forbiddenDir of boundary.forbidden) {
          const forbiddenPkg = [...workspacePkgs.values()].find((pkg) => pkg.dirRel === forbiddenDir);
          const forbiddenName = forbiddenPkg?.name;

          const viaPackageName = forbiddenName ? spec === forbiddenName || spec.startsWith(`${forbiddenName}/`) : false;

          let viaRelative = false;
          if (spec.startsWith('.')) {
            const targetAbs = normalizeImportTarget(spec, fileAbs);
            viaRelative = targetAbs ? targetAbs.startsWith(resolve(root, forbiddenDir)) : false;
          }

          if (viaPackageName || viaRelative) {
            errors.push({
              file: relFile,
              line,
              rule: 'forbidden-package-direction',
              message: `${boundary.from} must not import ${forbiddenDir} (${boundary.reason})`,
            });
          }
        }
      }
    }
  }

  if (errors.length === 0) {
    console.log('[imports] summary: 0 violation(s)');
    return;
  }

  console.log(`[imports] summary: ${errors.length} violation(s)`);
  for (const e of errors) {
    console.log(`  - ${e.file}:${e.line} ${e.rule}: ${e.message}`);
  }
  process.exit(1);
}

main();
