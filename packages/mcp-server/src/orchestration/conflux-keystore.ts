import type { DevkitConfig } from '@cfxdevkit/shared';
import type { DevkitClient } from '../clients/devkit-client.js';

type ToolArgs = Record<string, unknown>;

export async function handleConfluxKeystoreTool(params: {
  name: string;
  args: ToolArgs;
  devkitCfg: DevkitConfig;
  client: DevkitClient;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean } | null> {
  const { name, args: a, devkitCfg, client } = params;

  switch (name) {
    case 'conflux_setup_init': {
      const label = (a.label as string | undefined) ?? 'Default';
      const online = await client.isServerRunning(devkitCfg);
      if (!online) {
        return {
          content: [{ type: 'text', text: 'conflux-devkit server is not running. Start it first with "Conflux: Start DevKit Server" in VSCode or run `npx conflux-devkit --no-open` in the terminal.' }],
          isError: true,
        };
      }

      const ks = await client.getKeystoreStatus(devkitCfg);
      if (ks.initialized) {
        return {
          content: [{ type: 'text', text: `Keystore already initialized${ks.locked ? ' but locked — call conflux_keystore_unlock' : '. You can call conflux_node_start.'}` }],
        };
      }

      const mnemonic = await client.generateMnemonicWords(devkitCfg);
      await client.setupKeystore(mnemonic, label, undefined, devkitCfg);
      return {
        content: [{
          type: 'text',
          text: [
            `✅ Keystore initialized with label "${label}".`,
            '',
            '⚠️  SAVE THIS MNEMONIC — it is the only way to recover accounts:',
            `   ${mnemonic}`,
            '',
            'Next step: call conflux_node_start to start the blockchain node.',
          ].join('\n'),
        }],
      };
    }

    case 'conflux_keystore_status': {
      const online = await client.isServerRunning(devkitCfg);
      if (!online) {
        return {
          content: [{ type: 'text', text: 'conflux-devkit server is not running.' }],
          isError: true,
        };
      }

      const ks = await client.getKeystoreStatus(devkitCfg);
      const lines = [
        `Initialized:        ${ks.initialized}`,
        `Locked:             ${ks.locked}`,
        `Encryption enabled: ${ks.encryptionEnabled}`,
      ];
      if (!ks.initialized) {
        lines.push('', 'Action needed: call conflux_setup_init to initialize the keystore.');
      } else if (ks.locked) {
        lines.push('', 'Action needed: call conflux_keystore_unlock with your password.');
      } else {
        lines.push('', 'Keystore is ready. You can call conflux_node_start.');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    case 'conflux_keystore_unlock': {
      const password = a.password as string;
      await client.unlockKeystore(password, devkitCfg);
      return { content: [{ type: 'text', text: 'Keystore unlocked. You can now call conflux_node_start.' }] };
    }

    case 'conflux_wallets': {
      const wallets = await client.getWallets(devkitCfg);
      if (!wallets.length) {
        return { content: [{ type: 'text', text: 'No wallets found. Run conflux_setup_init first.' }] };
      }
      const lines = wallets.map((w) =>
        `${w.isActive ? '★' : ' '} [${w.id}] ${w.label}  admin: ${w.adminAddress}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    default:
      return null;
  }
}
