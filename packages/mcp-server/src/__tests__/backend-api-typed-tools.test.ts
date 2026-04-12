import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const mcpServerSource = readFileSync(join(repoRoot, 'packages/mcp-server/src/server.ts'), 'utf8');

const REQUIRED_TYPED_TOOLS = [
  'backend_health',
  'conflux_settings',
  'conflux_network_current',
  'conflux_network_set',
  'conflux_network_capabilities',
  'conflux_network_config_get',
  'conflux_network_config_set',
  'conflux_keystore_lock',
  'conflux_contract_template_get',
  'conflux_contract_get',
  'conflux_contract_delete',
  'conflux_contracts_clear',
  'dex_manifest_get',
  'dex_manifest_set',
  'dex_translation_table_get',
  'dex_translation_table_set',
  'dex_pricing_wcfx_usd',
  'dex_source_pools_refresh',
  'dex_runtime_state_clear',
  'agent_runbook_execute',
];

describe('backend API typed MCP tools', () => {
  it('registers required typed tools for backend parity', () => {
    for (const toolName of REQUIRED_TYPED_TOOLS) {
      const found = mcpServerSource.includes(`name: '${toolName}'`);
      expect(found, `Missing typed MCP wrapper tool: ${toolName}`).toBe(true);
    }
  });
});
