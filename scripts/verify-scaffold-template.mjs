#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = process.cwd();
const scaffoldRoot = resolve(repoRoot, 'scaffolds', 'project-example');
const uiSharedSrcRoot = resolve(scaffoldRoot, 'ui-shared', 'src');
const requiredScaffoldPaths = [
  'scaffolds/project-example/opencode.json',
  'scaffolds/project-example/AGENTS.md',
  'scaffolds/project-example/.opencode/skills/devkit-deploy/SKILL.md',
  'scaffolds/project-example/.opencode/skills/devkit-diagnostics/SKILL.md',
  'scaffolds/project-example/.opencode/skills/conflux-ecosystem/SKILL.md',
];

const disallowedSuffixes = ['.js', '.d.ts', '.d.ts.map'];
const allowedTypeShimPaths = new Set([
  'scaffolds/project-example/ui-shared/src/vite-env.d.ts',
]);

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        stack.push(fullPath);
      } else {
        out.push(fullPath);
      }
    }
  }
  return out;
}

const files = walkFiles(uiSharedSrcRoot);
const missingRequiredFiles = requiredScaffoldPaths.filter((relativePath) => !existsSync(resolve(repoRoot, relativePath)));
const violations = files
  .map((file) => file.replace(`${repoRoot}/`, ''))
  .filter((relativePath) => {
    if (allowedTypeShimPaths.has(relativePath)) return false;
    return disallowedSuffixes.some((suffix) => relativePath.endsWith(suffix));
  });

if (missingRequiredFiles.length > 0) {
  console.error('Scaffold template verification failed. Missing required agent contract files:');
  for (const file of missingRequiredFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

if (violations.length > 0) {
  console.error('Scaffold template verification failed. Generated artifacts found in ui-shared source:');
  for (const file of violations) {
    console.error(`- ${file}`);
  }
  console.error('Remove generated JS/declaration artifacts from scaffold template source files.');
  process.exit(1);
}

console.log('Scaffold template verification passed.');
