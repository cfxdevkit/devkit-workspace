/**
 * template/index.ts — built-in project template copy helpers.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from '../util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Template source resolution ─────────────────────────────────────────────

export function getPackagedTemplatePath(): string | null {
  // This module compiles to dist/template/index.js; the synced template is
  // at dist/template/project-example/ (one level down from __dirname).
  const packagedTemplate = join(__dirname, 'project-example');
  return existsSync(packagedTemplate) ? packagedTemplate : null;
}

export function getRepoAssemblerPath(): string | null {
  // dist/template/ → dist/ → packages/workspace-cli/ → packages/ → root → scripts/
  const assemblerPath = resolve(__dirname, '..', '..', '..', '..', 'scripts', 'assemble-project-example.mjs');
  return existsSync(assemblerPath) ? assemblerPath : null;
}

export function getRepoScaffoldPath(): string | null {
  const scaffoldPath = resolve(__dirname, '..', '..', '..', '..', 'scaffolds', 'project-example');
  return existsSync(scaffoldPath) ? scaffoldPath : null;
}

// ── FS helpers ─────────────────────────────────────────────────────────────

export function isDirectoryEmpty(path: string): boolean {
  return readdirSync(path).length === 0;
}

export function copyDirectoryContents(sourcePath: string, destinationPath: string): void {
  for (const entryName of readdirSync(sourcePath)) {
    cpSync(join(sourcePath, entryName), join(destinationPath, entryName), { recursive: true });
  }
}

// ── Template copy entry point ──────────────────────────────────────────────

export function copyBuiltInTemplate(destinationPath: string): void {
  const packagedTemplate = getPackagedTemplatePath();
  if (packagedTemplate) {
    copyDirectoryContents(packagedTemplate, destinationPath);
    return;
  }

  const assemblerPath = getRepoAssemblerPath();
  const scaffoldPath = getRepoScaffoldPath();
  if (assemblerPath && scaffoldPath) {
    execFileSync(process.execPath, [assemblerPath, destinationPath], { stdio: 'inherit' });
    return;
  }

  fail('Built-in project-example template not found. Rebuild or reinstall conflux-workspace.');
}
