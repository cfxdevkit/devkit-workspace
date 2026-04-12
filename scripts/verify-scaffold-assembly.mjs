#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const generatedRoot = resolve(repoRoot, '.generated', 'project-example');

const requiredPaths = [
  '.generated/project-example/package.json',
  '.generated/project-example/pnpm-workspace.yaml',
  '.generated/project-example/opencode.json',
  '.generated/project-example/AGENTS.md',
  '.generated/project-example/.opencode/skills/devkit-deploy/SKILL.md',
  '.generated/project-example/.opencode/skills/devkit-diagnostics/SKILL.md',
  '.generated/project-example/.opencode/skills/conflux-ecosystem/SKILL.md',
  '.generated/project-example/dapp/vite.config.ts',
  '.generated/project-example/dapp/src/providers.tsx',
  '.generated/project-example/ui-shared/package.json',
  '.generated/project-example/ui-shared/src/index.ts',
  '.generated/project-example/contracts/package.json',
];

const missing = requiredPaths.filter((relativePath) => !existsSync(resolve(repoRoot, relativePath)));

if (!existsSync(generatedRoot)) {
  console.error('Missing assembled project root: .generated/project-example');
  process.exit(1);
}

if (missing.length > 0) {
  console.error('Assembled scaffold verification failed. Missing required files:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log('Assembled scaffold verification passed.');
