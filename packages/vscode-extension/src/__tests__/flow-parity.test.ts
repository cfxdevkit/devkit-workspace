/**
 * flow-parity.test.ts
 *
 * Static guard: every MCP tool in the Conflux orchestration modules that has
 * a direct extension-command equivalent must appear as a string literal in the
 * corresponding source files on both sides.
 *
 * This prevents the two surfaces from silently drifting apart without the
 * extension needing a VS Code host or the MCP server needing to be running.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function readAll(dir: string): string {
  const collect = (d: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...collect(full));
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
  };
  return collect(dir)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

// ── Fixture loading ───────────────────────────────────────────────────────────

const repoRoot = resolve(__dirname, '../../../..');

const mcpOrchestrationSrc = readAll(
  join(repoRoot, 'packages/mcp-server/src/orchestration'),
);

const extensionSrc = readAll(join(repoRoot, 'packages/vscode-extension/src'));

// ── Flow-parity table ─────────────────────────────────────────────────────────
//
// Each row declares one logical Conflux operation and how it surfaces on each
// layer.  `extensionCommand: null` means the operation is handled internally
// (e.g. by a status-bar poller or a tree-view provider) with no dedicated
// command, which is an explicit and acceptable gap.
//
const FLOW_MAP: Array<{
  mcpTool: string;
  extensionCommand: string | null;
  note?: string;
}> = [
  // ── Lifecycle ───────────────────────────────────────────────────────────────
  { mcpTool: 'conflux_server_start',     extensionCommand: 'cfxdevkit.serverStart'     },
  { mcpTool: 'conflux_status',           extensionCommand: null,                        note: 'handled by status-bar poller' },
  { mcpTool: 'conflux_node_status',      extensionCommand: null,                        note: 'embedded in tree-view refresh' },
  { mcpTool: 'conflux_node_start',       extensionCommand: 'cfxdevkit.nodeStart'        },
  { mcpTool: 'conflux_node_stop',        extensionCommand: 'cfxdevkit.nodeStop'         },
  { mcpTool: 'conflux_node_restart',     extensionCommand: 'cfxdevkit.nodeRestart'      },
  { mcpTool: 'conflux_node_wipe_restart',extensionCommand: 'cfxdevkit.nodeWipeRestart'  },
  { mcpTool: 'conflux_node_wipe',        extensionCommand: 'cfxdevkit.nodeWipe'         },

  // ── Keystore ────────────────────────────────────────────────────────────────
  { mcpTool: 'conflux_setup_init',       extensionCommand: 'cfxdevkit.initializeSetup'  },
  { mcpTool: 'conflux_keystore_status',  extensionCommand: null,                        note: 'embedded in status-bar poller' },
  { mcpTool: 'conflux_keystore_unlock',  extensionCommand: 'cfxdevkit.unlockKeystore'   },
  { mcpTool: 'conflux_wallets',          extensionCommand: 'cfxdevkit.viewAccounts'     },

  // ── Network ─────────────────────────────────────────────────────────────────
  { mcpTool: 'conflux_rpc_urls',         extensionCommand: null,                        note: 'surfaced via web UI / tree view' },
  { mcpTool: 'conflux_accounts',         extensionCommand: 'cfxdevkit.viewAccounts'     },
  { mcpTool: 'conflux_fund_account',     extensionCommand: null,                        note: 'surfaced via web UI faucet panel' },
  { mcpTool: 'conflux_mine',             extensionCommand: 'cfxdevkit.mineBlocks'       },
  { mcpTool: 'conflux_mining_start',     extensionCommand: null,                        note: 'handled by auto-mining toggle in web UI' },
  { mcpTool: 'conflux_mining_stop',      extensionCommand: null,                        note: 'handled by auto-mining toggle in web UI' },

  // ── Contracts ───────────────────────────────────────────────────────────────
  { mcpTool: 'conflux_templates',        extensionCommand: null,                        note: 'embedded in cfxdevkit.deployContract flow' },
  { mcpTool: 'conflux_deploy',           extensionCommand: 'cfxdevkit.deployContract'   },
  { mcpTool: 'conflux_contracts',        extensionCommand: 'cfxdevkit.listContracts'    },
  { mcpTool: 'conflux_bootstrap_catalog',extensionCommand: null,                        note: 'embedded in cfxdevkit.deployDex flow' },
  { mcpTool: 'conflux_bootstrap_deploy', extensionCommand: 'cfxdevkit.deployDex'        },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MCP ↔ extension flow parity', () => {
  it('flow map is non-empty', () => {
    expect(FLOW_MAP.length).toBeGreaterThan(0);
  });

  it('MCP orchestration source is non-empty', () => {
    expect(mcpOrchestrationSrc.length).toBeGreaterThan(0);
  });

  it('extension source is non-empty', () => {
    expect(extensionSrc.length).toBeGreaterThan(0);
  });

  it.each(FLOW_MAP)(
    '$mcpTool — MCP tool name appears in orchestration source',
    ({ mcpTool }) => {
      const present =
        mcpOrchestrationSrc.includes(`'${mcpTool}'`) ||
        mcpOrchestrationSrc.includes(`"${mcpTool}"`);
      expect(
        present,
        `MCP tool '${mcpTool}' not found as a string literal in packages/mcp-server/src/orchestration/**`,
      ).toBe(true);
    },
  );

  it.each(FLOW_MAP.filter((r) => r.extensionCommand !== null))(
    '$mcpTool → $extensionCommand — extension command appears in source',
    ({ extensionCommand }) => {
      const present =
        extensionSrc.includes(`'${extensionCommand}'`) ||
        extensionSrc.includes(`"${extensionCommand}"`);
      expect(
        present,
        `Extension command '${extensionCommand}' not found as a string literal in packages/vscode-extension/src/**`,
      ).toBe(true);
    },
  );
});
