#!/usr/bin/env node
import { execSync } from 'node:child_process';

const FORBIDDEN_PREFIXES = [
  'node_modules/',
  '.generated/',
  'dex-ui/dist/',
  'project-example/',
];

const FORBIDDEN_REGEX = [
  /^packages\/[^/]+\/dist\//,
];

const ALLOWLIST_PREFIXES = [
  'scaffolds/project-example/',
];

// Transitional allowlist for currently tracked legacy generated artifacts.
// Run with --strict to fail on these too.
const LEGACY_ALLOWED_PREFIXES = [
  'packages/contracts/hh-artifacts/',
  'packages/contracts/hh-cache/',
  'packages/contracts/typechain-types/',
];

const STRICT = process.argv.includes('--strict');

function isForbidden(path) {
  if (ALLOWLIST_PREFIXES.some((p) => path.startsWith(p))) {
    return false;
  }
  if (!STRICT && LEGACY_ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return false;
  }
  if (FORBIDDEN_PREFIXES.some((p) => path.startsWith(p))) {
    return true;
  }
  return FORBIDDEN_REGEX.some((rx) => rx.test(path));
}

const output = execSync('git ls-files', { encoding: 'utf8' });
const tracked = output.split('\n').map((s) => s.trim()).filter(Boolean);
const violations = tracked.filter(isForbidden);

if (violations.length > 0) {
  console.error('Artifact policy violations found (tracked ephemeral files):');
  for (const f of violations) {
    console.error(` - ${f}`);
  }
  process.exit(1);
}

if (!STRICT) {
  console.log('Artifact policy check passed (legacy generated artifacts are temporarily allowlisted).');
} else {
  console.log('Artifact policy check passed (strict mode).');
}
