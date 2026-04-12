import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSION_CAPABILITY_MAP } from '../extension-capability-map.js';

function readAllTs(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        files.push(full);
      }
    }
  };
  walk(dir);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const extensionSource = readAllTs(join(repoRoot, 'packages/vscode-extension/src'));
const mcpSource = readAllTs(join(repoRoot, 'packages/mcp-server/src'));

describe('extension capability parity map', () => {
  it('has at least one command family', () => {
    expect(EXTENSION_CAPABILITY_MAP.length).toBeGreaterThan(0);
  });

  it('mapped extension commands exist in extension source', () => {
    for (const family of EXTENSION_CAPABILITY_MAP) {
      for (const cmd of family.extensionExamples) {
        const found = extensionSource.includes(`'${cmd}'`) || extensionSource.includes(`"${cmd}"`);
        expect(found, `Missing extension command literal: ${cmd}`).toBe(true);
      }
    }
  });

  it('mapped MCP tools are registered in server tool definitions', () => {
    for (const family of EXTENSION_CAPABILITY_MAP) {
      for (const tool of family.mcpTools) {
        const found = mcpSource.includes(`name: '${tool}'`) || mcpSource.includes(`case '${tool}'`);
        expect(found, `Missing MCP tool definition for mapped tool: ${tool}`).toBe(true);
      }
    }
  });
});
