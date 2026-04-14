#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dappRoot = process.cwd();
const projectRoot = resolve(dappRoot, '..');
const distRoot = resolve(dappRoot, 'dist');

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });

cpSync(resolve(dappRoot, 'index.html'), resolve(distRoot, 'index.html'));
cpSync(resolve(dappRoot, 'src'), resolve(distRoot, 'src'), { recursive: true });
cpSync(resolve(projectRoot, 'ui-shared', 'src'), resolve(distRoot, 'ui-shared', 'src'), { recursive: true });
cpSync(resolve(projectRoot, 'contracts', 'generated'), resolve(distRoot, 'contracts', 'generated'), { recursive: true });

console.log(`Built reference dapp into ${distRoot}`);
