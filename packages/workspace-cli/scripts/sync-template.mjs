#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleProjectExample } from '../../../scripts/assemble-project-example.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageRoot = resolve(__dirname, '..');
const target = resolve(packageRoot, 'dist', 'template', 'project-example');
const source = resolve(packageRoot, '..', '..', 'scaffolds', 'project-example');

if (!existsSync(source)) {
  console.error(`Template source not found: ${source}`);
  process.exit(1);
}

assembleProjectExample({ destination: target, scaffoldSource: source });