import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');
const mcpDefsPath = join(repoRoot, 'packages/mcp-server/src/features/dex/dex-tool-definitions.ts');
const extSrcPath = join(repoRoot, 'packages/vscode-extension/src/commands/conflux-deploy-commands.ts');

const mcpDefs = readFileSync(mcpDefsPath, 'utf8');
const extSource = readFileSync(extSrcPath, 'utf8');

const FLOW_MAP: Array<{ mcpTool: string; extensionCommand: string | null; note?: string }> = [
  { mcpTool: 'dex_deploy', extensionCommand: 'cfxdevkit.deployDex' },
  { mcpTool: 'dex_seed_from_gecko', extensionCommand: 'cfxdevkit.deployDex', note: 'seed is nested in deployDex flow' },
  { mcpTool: 'dex_status', extensionCommand: null, note: 'handled by DEX status bar and scripted flow' },
  { mcpTool: 'dex_simulation_step', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_simulation_start', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_simulation_stop', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_simulation_reset', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_create_token', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_create_pair', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_add_liquidity', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_remove_liquidity', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_swap', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_pool_info', extensionCommand: null, note: 'MCP-only advanced operation' },
  { mcpTool: 'dex_list_pairs', extensionCommand: null, note: 'MCP-only advanced operation' },
];

describe('DEX MCP ↔ extension flow parity', () => {
  it.each(FLOW_MAP)('$mcpTool exists in MCP definitions', ({ mcpTool }) => {
    expect(mcpDefs.includes(`name: '${mcpTool}'`)).toBe(true);
  });

  it.each(FLOW_MAP.filter((row) => row.extensionCommand !== null))(
    '$mcpTool maps to extension command literal',
    ({ extensionCommand }) => {
      expect(extSource.includes(`'${extensionCommand}'`) || extSource.includes(`"${extensionCommand}"`)).toBe(true);
    },
  );
});
