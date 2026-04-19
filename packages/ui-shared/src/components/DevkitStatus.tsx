import { useEffect, useState } from "react";

interface NodeStatus {
	server: "stopped" | "starting" | "running" | "stopping" | "error";
}

function appBasePath(): string {
	if (typeof window === "undefined") {
		return import.meta.env.BASE_URL;
	}

	const match = window.location.pathname.match(/^(.*\/proxy\/\d+\/)/);
	if (match) {
		return match[1];
	}

	return import.meta.env.BASE_URL;
}

function appUrl(path: string): string {
	return `${appBasePath()}${path.replace(/^\/+/, "")}`;
}

export function DevkitStatus() {
	const [serverOnline, setServerOnline] = useState<boolean | null>(null);
	const [node, setNode] = useState<NodeStatus | null>(null);
	const [blockNumber, setBlockNumber] = useState<number | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function poll() {
			try {
				const response = await fetch(appUrl("api/node/status"), {
					signal: AbortSignal.timeout(4000),
				});
				if (cancelled) return;
				const data = (await response.json()) as NodeStatus;
				setServerOnline(true);
				setNode(data);
			} catch {
				if (!cancelled) {
					setServerOnline(false);
					setNode(null);
					setBlockNumber(null);
				}
			}

			try {
				const response = await fetch(appUrl("rpc"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "eth_blockNumber",
						params: [],
					}),
					signal: AbortSignal.timeout(4000),
				});
				if (cancelled || !response.ok) return;
				const data = (await response.json()) as { result?: string };
				setBlockNumber(data.result ? Number.parseInt(data.result, 16) : null);
			} catch {
				if (!cancelled) setBlockNumber(null);
			}
		}

		void poll();
		const intervalId = setInterval(() => {
			void poll();
		}, 10_000);

		return () => {
			cancelled = true;
			clearInterval(intervalId);
		};
	}, []);

	const serverLabel =
		serverOnline === null ? "…" : serverOnline ? "Online" : "Offline";
	const nodeLabel =
		node === null
			? "–"
			: node.server === "running"
				? `Active · BLK ${blockNumber ?? "?"}`
				: node.server;

	return (
		<div className="flex flex-col gap-2 rounded-[1rem] border border-white/8 bg-white/[0.04] p-3.5 shadow-inner">
			<p className="text-[9px] font-black uppercase tracking-[0.18em] text-text-secondary/65">
				DevKit Status
			</p>
			<div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-bg-primary/30 px-3 py-2">
				<span className="text-[10px] font-bold text-text-secondary/75">
					Registry
				</span>
				<span
					className={`text-[10px] font-black uppercase tracking-[0.16em] ${serverOnline ? "text-success" : serverOnline === null ? "text-text-secondary/65" : "text-error"}`}
				>
					{serverLabel}
				</span>
			</div>
			<div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-bg-primary/30 px-3 py-2">
				<span className="text-[10px] font-bold text-text-secondary/75">
					Node
				</span>
				<span
					className={`text-[10px] font-black uppercase tracking-[0.16em] ${node?.server === "running" ? "text-success" : "text-text-secondary/70"}`}
				>
					{nodeLabel}
				</span>
			</div>
		</div>
	);
}
