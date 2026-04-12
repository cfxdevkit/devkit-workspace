import type { DevkitConfig } from '@cfxdevkit/shared';
import type { DevkitClient } from '../clients/devkit-client.js';

type ToolArgs = Record<string, unknown>;

export async function handleConfluxNetworkTool(params: {
  name: string;
  args: ToolArgs;
  devkitCfg: DevkitConfig;
  client: DevkitClient;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
  const { name, args: a, devkitCfg, client } = params;

  switch (name) {
    case 'conflux_rpc_urls': {
      const urls = await client.getRpcUrls(devkitCfg);
      const cfg = await client.getNetworkConfig(devkitCfg);
      return {
        content: [{
          type: 'text',
          text: [
            `Running: ${urls.running}`,
            '',
            `Core Space (chainId: ${cfg.chainId}):`,
            `  HTTP: ${urls.core}`,
            `  WS:   ${urls.coreWs ?? `ws://127.0.0.1:${cfg.wsPort}`}`,
            '',
            `eSpace (chainId: ${cfg.evmChainId}):`,
            `  HTTP: ${urls.evm}`,
            `  WS:   ${urls.evmWs ?? `ws://127.0.0.1:${cfg.evmWsPort}`}`,
          ].join('\n'),
        }],
      };
    }

    case 'conflux_accounts': {
      const accounts = await client.getAccounts(devkitCfg);
      if (!accounts.length) {
        return { content: [{ type: 'text', text: 'No accounts found. Is the node running?' }] };
      }
      const lines = accounts.map((acc) =>
        `[${acc.index}] Core: ${acc.coreAddress}  eSpace: ${acc.evmAddress}` +
        (acc.coreBalance ? `  Balance: ${acc.coreBalance} CFX` : '')
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'conflux_fund_account': {
      const address = a.address as string;
      const amount = (a.amount as string | undefined) ?? '100';
      const chain = a.chain as 'core' | 'evm' | undefined;
      await client.fundAccount(address, amount, chain, devkitCfg);
      return {
        content: [{
          type: 'text',
          text: `Funded ${address} with ${amount} CFX${chain ? ` on ${chain}` : ''}.`,
        }],
      };
    }

    case 'conflux_mine': {
      const blocks = (a.blocks as number | undefined) ?? 1;
      await client.mine(blocks, devkitCfg);
      const miningStatus = await client.getMiningStatus(devkitCfg);
      return {
        content: [{
          type: 'text',
          text: `Mined ${blocks} block(s). Total mined: ${miningStatus.blocksMined ?? 0}`,
        }],
      };
    }

    case 'conflux_mining_start': {
      const intervalMs = (a.intervalMs as number | undefined) ?? 2000;
      const status = await client.startMining(intervalMs, devkitCfg);
      return {
        content: [{ type: 'text', text: `Auto-mining started (interval: ${intervalMs}ms). Running: ${status.isRunning}` }],
      };
    }

    case 'conflux_mining_stop': {
      const status = await client.stopMining(devkitCfg);
      return {
        content: [{ type: 'text', text: `Auto-mining stopped. Blocks mined: ${status.blocksMined ?? 0}` }],
      };
    }

    default:
      return null;
  }
}
