#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = process.cwd();
const strictMode = process.argv.includes('--strict');

const requiredScripts = ['build', 'typecheck'];
const allowedProfileFiles = new Set([
  'tsconfig.profile.node-cjs.json',
  'tsconfig.profile.node-esm.json',
  'tsconfig.profile.vscode-extension.json',
  'tsconfig.profile.browser-lib.json',
]);
const profileExceptions = new Set([
  'packages/contracts',
  // Intentionally self-contained so scaffold/example templates do not rely on
  // repo-root tsconfig profiles when assembled standalone.
  'packages/ui-shared',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hasTests(pkgDir, pkgJson) {
  const scripts = pkgJson.scripts ?? {};
  if (typeof scripts.test === 'string') return true;

  const srcTests = join(pkgDir, 'src', '__tests__');
  if (existsSync(srcTests) && statSync(srcTests).isDirectory()) return true;

  return false;
}

function validatePackage(pkgDir) {
  const issues = [];
  const relPkgDir = pkgDir.replace(`${root}/`, '');
  const pkgJsonPath = join(pkgDir, 'package.json');
  const tsconfigPath = join(pkgDir, 'tsconfig.json');

  if (!existsSync(pkgJsonPath)) {
    issues.push({ level: 'error', ruleId: 'package-json-missing', message: 'package.json is missing' });
    return issues;
  }

  const pkgJson = readJson(pkgJsonPath);
  const scripts = pkgJson.scripts ?? {};

  if (!existsSync(tsconfigPath)) {
    issues.push({ level: 'error', ruleId: 'tsconfig-missing', message: 'tsconfig.json is missing' });
  } else {
    const tsconfig = readJson(tsconfigPath);
    if (profileExceptions.has(relPkgDir)) {
      // Approved exception: generated-artifact package keeps specialized tsconfig.
    } else if (typeof tsconfig.extends !== 'string') {
      issues.push({
        level: 'warn',
        ruleId: 'tsconfig-profile-missing',
        message: 'tsconfig.json does not extend a root profile yet',
      });
    } else if (!allowedProfileFiles.has(basename(tsconfig.extends))) {
      issues.push({
        level: 'warn',
        ruleId: 'tsconfig-profile-unknown',
        message: `tsconfig extends ${tsconfig.extends}, which is not in the approved profile list`,
      });
    }
  }

  for (const name of requiredScripts) {
    if (typeof scripts[name] !== 'string' || scripts[name].trim() === '') {
      issues.push({
        level: 'warn',
        ruleId: 'required-script-missing',
        message: `missing required script: ${name}`,
      });
    }
  }

  if (hasTests(pkgDir, pkgJson) && typeof scripts['test:watch'] !== 'string') {
    issues.push({
      level: 'warn',
      ruleId: 'test-watch-missing',
      message: 'tests detected but script test:watch is missing',
    });
  }

  return issues;
}

function main() {
  const packagesDir = resolve(root, 'packages');
  if (!existsSync(packagesDir)) {
    console.error('[format] packages directory not found');
    process.exit(1);
  }

  const packageDirs = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((path) => statSync(path).isDirectory());

  let errorCount = 0;
  let warnCount = 0;

  for (const pkgDir of packageDirs) {
    const rel = pkgDir.replace(`${root}/`, '');
    const issues = validatePackage(pkgDir);
    if (issues.length === 0) continue;

    console.log(`\n[format] ${rel}`);
    for (const issue of issues) {
      const prefix = issue.level === 'error' ? 'ERROR' : 'WARN';
      console.log(`  - ${prefix} ${issue.ruleId}: ${issue.message}`);
      if (issue.level === 'error') errorCount++;
      else warnCount++;
    }
  }

  console.log(`\n[format] summary: ${errorCount} error(s), ${warnCount} warning(s)`);

  if (errorCount > 0) process.exit(1);
  if (strictMode && warnCount > 0) process.exit(2);
}

main();
