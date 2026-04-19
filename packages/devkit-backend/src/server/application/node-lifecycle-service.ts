import type { NodeManager } from "../node-manager.js";

export class NodeLifecycleService {
	constructor(private readonly nodeManager: NodeManager) {}

	getStatus(): {
		server: string;
		mining: unknown;
		rpcUrls: unknown;
		accounts: number;
		config: ReturnType<NodeManager["getConfig"]>;
	} {
		const manager = this.nodeManager.getManager();
		if (!manager) {
			return {
				server: "stopped",
				mining: null,
				rpcUrls: null,
				accounts: 0,
				config: this.nodeManager.getConfig(),
			};
		}

		return manager.getNodeStatus();
	}

	async start(): Promise<{ ok: true; status: unknown }> {
		await this.nodeManager.start();
		const manager = this.nodeManager.requireManager();
		return { ok: true, status: manager.getNodeStatus() };
	}

	async stop(): Promise<{ ok: true; server: "stopped" }> {
		await this.nodeManager.stop();
		return { ok: true, server: "stopped" };
	}

	async restart(): Promise<{ ok: true; status: unknown }> {
		await this.nodeManager.restart();
		const manager = this.nodeManager.requireManager();
		return { ok: true, status: manager.getNodeStatus() };
	}

	async restartWipe(): Promise<{ ok: true; status: unknown }> {
		await this.nodeManager.restartWipe();
		const manager = this.nodeManager.requireManager();
		return { ok: true, status: manager.getNodeStatus() };
	}

	async wipe(): Promise<{ ok: true; server: "stopped" }> {
		await this.nodeManager.wipeData();
		return { ok: true, server: "stopped" };
	}
}
