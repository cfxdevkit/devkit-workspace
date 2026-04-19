import { spawn } from "node:child_process";
import type { DevkitConfig } from "@devkit/shared";
import type { DevkitClient } from "../clients/devkit-client.js";

type ToolArgs = Record<string, unknown>;

export async function handleConfluxLifecycleTool(params: {
	name: string;
	args: ToolArgs;
	devkitCfg: DevkitConfig;
	client: DevkitClient;
}): Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
} | null> {
	const { name, devkitCfg, client } = params;

	switch (name) {
		case "conflux_server_start": {
			const alreadyRunning = await client.isServerRunning(devkitCfg);
			if (alreadyRunning) {
				return {
					content: [
						{
							type: "text",
							text: "✓ conflux-devkit server is already running. Call conflux_status to continue.",
						},
					],
				};
			}

			const port = (devkitCfg.port ?? 7748).toString();
			const child = spawn(
				"npx",
				["conflux-devkit", "--no-open", "--port", port],
				{
					detached: true,
					stdio: "ignore",
				},
			);
			child.unref();

			const deadline = Date.now() + 30_000;
			let ready = false;
			while (Date.now() < deadline) {
				await new Promise<void>((r) => setTimeout(r, 2000));
				if (await client.isServerRunning(devkitCfg)) {
					ready = true;
					break;
				}
			}

			if (!ready) {
				return {
					content: [
						{
							type: "text",
							text: "conflux-devkit server did not become ready within 30 s. Try starting it manually in the terminal: npx conflux-devkit --no-open",
						},
					],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: "✅ conflux-devkit server started and ready. Call conflux_status to continue the setup lifecycle.",
					},
				],
			};
		}

		case "conflux_status": {
			const full = await client.getStatus(devkitCfg);
			const ks = full.keystoreStatus;
			const ns = full.nodeStatus;
			const lines = [
				`Server:    ${full.serverOnline ? "✓ online" : "✗ offline"}`,
				`Keystore:  ${!ks ? "unknown" : ks.initialized ? (ks.locked ? "⚠ locked" : "✓ ready") : "✗ not initialized"}`,
				`Node:      ${!ns ? "unknown" : ns.server}`,
				"",
				`Next step: ${full.nextStep}`,
			];
			if (full.nodeRunning && ns?.rpcUrls) {
				lines.push(
					"",
					`Core RPC:   ${ns.rpcUrls.core}`,
					`eSpace RPC: ${ns.rpcUrls.evm}`,
				);
			}
			return { content: [{ type: "text", text: lines.join("\n") }] };
		}

		case "conflux_node_status": {
			const online = await client.isServerRunning(devkitCfg);
			if (!online) {
				return {
					content: [
						{
							type: "text",
							text: "conflux-devkit server is not running. Use conflux_status for full lifecycle check.",
						},
					],
					isError: true,
				};
			}

			const status = await client.getNodeStatus(devkitCfg);
			const rpc = status.rpcUrls
				? `\nCore RPC:   ${status.rpcUrls.core}\neSpace RPC: ${status.rpcUrls.evm}`
				: "";
			const mining = status.mining
				? `\nMining: ${status.mining.isRunning ? `running (${status.mining.blocksMined ?? 0} blocks)` : "stopped"}`
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Node status: ${status.server}\nAccounts: ${status.accounts}${rpc}${mining}`,
					},
				],
			};
		}

		case "conflux_node_start": {
			const online = await client.isServerRunning(devkitCfg);
			if (!online) {
				return {
					content: [
						{
							type: "text",
							text: 'conflux-devkit server is not running. Start it first ("Conflux: Start DevKit Server" in VSCode or `npx conflux-devkit --no-open`).',
						},
					],
					isError: true,
				};
			}
			// Idempotency: if the node is already running, return success instead of erroring.
			const precheck = await client.getStatus(devkitCfg).catch(() => null);
			if (precheck?.nodeRunning) {
				const ns = precheck.nodeStatus;
				return {
					content: [
						{
							type: "text",
							text: [
								"✓ Node is already running — no action needed.",
								`Core RPC:   ${ns?.rpcUrls?.core ?? "http://127.0.0.1:12537"}  (chainId: 2029)`,
								`eSpace RPC: ${ns?.rpcUrls?.evm ?? "http://127.0.0.1:8545"}   (chainId: 2030)`,
								`Accounts:   ${ns?.accounts ?? 10} pre-funded genesis accounts`,
								"",
								"The stack is ready. You can now deploy contracts or interact with the chain.",
							].join("\n"),
						},
					],
				};
			}
			const status = await client.startNode(devkitCfg);
			return {
				content: [
					{
						type: "text",
						text: [
							"✅ Node started.",
							`Status:     ${status.server}`,
							`Core RPC:   ${status.rpcUrls?.core ?? "http://127.0.0.1:12537"}  (chainId: 2029)`,
							`eSpace RPC: ${status.rpcUrls?.evm ?? "http://127.0.0.1:8545"}   (chainId: 2030)`,
							`Accounts:   ${status.accounts} pre-funded genesis accounts`,
						].join("\n"),
					},
				],
			};
		}

		case "conflux_node_stop": {
			await client.stopNode(devkitCfg);
			return {
				content: [
					{
						type: "text",
						text: "Conflux node stopped. Blockchain data is preserved.",
					},
				],
			};
		}

		case "conflux_node_restart": {
			const status = await client.restartNode(devkitCfg);
			return {
				content: [
					{
						type: "text",
						text: `Node restarted.\nStatus: ${status.server}\nCore RPC: ${status.rpcUrls?.core ?? "n/a"}\neSpace RPC: ${status.rpcUrls?.evm ?? "n/a"}`,
					},
				],
			};
		}

		case "conflux_node_wipe_restart": {
			const status = await client.restartWipeNode(devkitCfg);
			return {
				content: [
					{
						type: "text",
						text: [
							"✅ Node wiped and restarted fresh.",
							`Status:     ${status.server}`,
							`Core RPC:   ${status.rpcUrls?.core ?? "http://127.0.0.1:12537"}`,
							`eSpace RPC: ${status.rpcUrls?.evm ?? "http://127.0.0.1:8545"}`,
							"",
							"All contracts and balances have been reset. Mnemonic and account addresses unchanged.",
						].join("\n"),
					},
				],
			};
		}

		case "conflux_node_wipe": {
			await client.wipeNodeData(devkitCfg);
			return {
				content: [
					{
						type: "text",
						text: "Node stopped and data wiped. Call conflux_node_start to bring it back up fresh.",
					},
				],
			};
		}

		default:
			return null;
	}
}
