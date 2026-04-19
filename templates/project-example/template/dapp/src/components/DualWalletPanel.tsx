import { useQuery } from "@tanstack/react-query";
import {
	useAccount,
	useBalance,
	useChainId,
	useConnect,
	useDisconnect,
	usePublicClient,
} from "wagmi";
import { getChainLabel } from "../chains";
import {
	getCoreChainConfigForEspaceChain,
	getCoreChainLabel,
	normalizeCoreAddressForChain,
	readCoreSnapshot,
	useCoreWallet,
} from "../hooks/useCoreWallet";
import { useDevkitNetworkSync } from "../hooks/useDevkitNetwork";

function formatAddress(address: string | null | undefined) {
	if (!address) {
		return "Not connected";
	}

	if (address.includes(":")) {
		return `${address.slice(0, 12)}…${address.slice(-6)}`;
	}

	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function StatusBadge({
	tone,
	label,
}: {
	tone: "neutral" | "success" | "warning";
	label: string;
}) {
	const toneClassName =
		tone === "success"
			? "border-success/25 bg-success/10 text-success"
			: tone === "warning"
				? "border-warning/25 bg-warning/10 text-warning"
				: "border-border/60 bg-bg-tertiary/40 text-text-secondary";

	return (
		<span
			className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${toneClassName}`}
		>
			{label}
		</span>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2 last:border-b-0 last:pb-0">
			<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
				{label}
			</span>
			<span className="font-mono text-xs text-text-primary">{value}</span>
		</div>
	);
}

function WalletCard({
	title,
	subtitle,
	badge,
	children,
	actions,
}: {
	title: string;
	subtitle: string;
	badge: React.ReactNode;
	children: React.ReactNode;
	actions: React.ReactNode;
}) {
	return (
		<article className="flex h-full flex-col rounded-2xl border border-border/50 bg-bg-secondary/30 p-5 shadow-xl shadow-black/20 backdrop-blur-md">
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-sm font-black uppercase tracking-[0.16em] text-white">
						{title}
					</h3>
					<p className="mt-1 text-sm leading-6 text-text-secondary/70">
						{subtitle}
					</p>
				</div>
				{badge}
			</div>
			<div className="mt-5 flex-1 space-y-1">{children}</div>
			<div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>
		</article>
	);
}

export function DualWalletPanel() {
	const { address: espaceAddress, isConnected: isEspaceConnected } =
		useAccount();
	const espaceChainId = useChainId();
	const {
		connect,
		connectors: espaceConnectors,
		isPending: isEspaceConnecting,
	} = useConnect();
	const { disconnect } = useDisconnect();
	const { isWrongChain, switchToTargetChain, targetChainId } =
		useDevkitNetworkSync();
	const espacePublicClient = usePublicClient({ chainId: targetChainId });
	const coreWallet = useCoreWallet();
	const targetCoreChain = getCoreChainConfigForEspaceChain(targetChainId);
	const normalizedCoreAddress = normalizeCoreAddressForChain(
		coreWallet.address,
		targetCoreChain.coreChainId,
	);
	const espaceBalanceQuery = useBalance({
		address: espaceAddress,
		chainId: targetChainId,
		query: {
			enabled: !!espaceAddress,
			refetchInterval: 10_000,
		},
	});
	const espaceSnapshotQuery = useQuery({
		queryKey: ["espace-snapshot", targetChainId, espaceAddress],
		enabled: !!espacePublicClient,
		refetchInterval: 10_000,
		queryFn: async () => {
			if (!espacePublicClient) {
				throw new Error("eSpace RPC unavailable.");
			}

			const [blockNumber, chainId] = await Promise.all([
				espacePublicClient.getBlockNumber(),
				espacePublicClient.getChainId(),
			]);

			return {
				blockNumber: blockNumber.toString(),
				chainId: String(chainId),
			};
		},
	});
	const coreSnapshotQuery = useQuery({
		queryKey: [
			"core-snapshot",
			targetCoreChain.coreChainId,
			targetCoreChain.rpcUrl,
			normalizedCoreAddress,
		],
		enabled: coreWallet.isAvailable,
		refetchInterval: 10_000,
		queryFn: () => readCoreSnapshot(targetCoreChain, normalizedCoreAddress),
	});
	const isCoreOnTarget =
		coreWallet.chainId?.toLowerCase() === targetCoreChain.chainIdHex;
	const isCoreConnectedAndReady = coreWallet.isConnected && isCoreOnTarget;
	const isCoreConnectedWrongChain = coreWallet.isConnected && !isCoreOnTarget;
	const preferredEspaceConnector =
		espaceConnectors.find((connector) => connector.id === "metaMask") ??
		espaceConnectors.find((connector) => connector.type === "injected") ??
		espaceConnectors[0];
	const eSpaceButtonLabel = !isEspaceConnected
		? "Connect eSpace"
		: isWrongChain
			? `Switch to ${getChainLabel(targetChainId)}`
			: "Wallet Ready";
	const coreButtonLabel = !coreWallet.isConnected
		? "Connect Core"
		: isCoreConnectedWrongChain
			? `Switch to ${targetCoreChain.label}`
			: "Wallet Ready";

	return (
		<section className="card overflow-hidden">
			<div className="flex flex-col gap-3 border-b border-white/5 pb-5 md:flex-row md:items-end md:justify-between">
				<div>
					<div className="text-[10px] font-black uppercase tracking-[0.28em] text-accent/70">
						Wallet Surfaces
					</div>
					<h2 className="mt-2 text-xl font-black uppercase tracking-[0.08em] text-white">
						Dual-Space Connection Probe
					</h2>
					<p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary/70">
						This MVP keeps one app shell and exposes two explicit provider
						paths: wagmi for eSpace and direct injected calls for Core Space.
					</p>
				</div>
				<div className="rounded-2xl border border-accent/10 bg-accent/5 px-4 py-3 text-right">
					<div className="text-[9px] font-black uppercase tracking-[0.18em] text-accent/70">
						Current Scope
					</div>
					<div className="mt-1 text-sm font-bold text-white">
						Provider connect flow only
					</div>
					<div className="mt-1 text-[11px] text-text-secondary/60">
						Core auth stays out of this first pass.
					</div>
				</div>
			</div>

			<div className="mt-6 grid gap-4 xl:grid-cols-2">
				<WalletCard
					title="eSpace Wallet"
					subtitle="Existing EVM path through wagmi and the injected provider."
					badge={
						<StatusBadge
							tone={
								isEspaceConnected
									? isWrongChain
										? "warning"
										: "success"
									: "neutral"
							}
							label={
								isEspaceConnected
									? isWrongChain
										? "Wrong Network"
										: "Connected"
									: "Idle"
							}
						/>
					}
					actions={
						<>
							<button
								type="button"
								onClick={() => {
									if (!isEspaceConnected) {
										if (!preferredEspaceConnector) {
											return;
										}
										connect({ connector: preferredEspaceConnector });
										return;
									}

									if (isWrongChain) {
										switchToTargetChain();
									}
								}}
								disabled={
									isEspaceConnecting ||
									(!preferredEspaceConnector && !isEspaceConnected) ||
									(isEspaceConnected && !isWrongChain)
								}
								className="btn btn-secondary !px-4 !py-2 text-xs"
							>
								{isEspaceConnecting ? "Connecting…" : eSpaceButtonLabel}
							</button>
							{isEspaceConnected ? (
								<button
									type="button"
									onClick={() => disconnect()}
									className="btn btn-ghost !px-4 !py-2 text-xs"
								>
									Disconnect
								</button>
							) : null}
						</>
					}
				>
					<DetailRow label="Provider" value="window.ethereum" />
					<DetailRow label="Account" value={formatAddress(espaceAddress)} />
					<DetailRow label="Network" value={getChainLabel(espaceChainId)} />
					<DetailRow label="Target" value={getChainLabel(targetChainId)} />
					<DetailRow
						label="RPC State"
						value={
							espaceSnapshotQuery.isLoading
								? "Querying…"
								: espaceSnapshotQuery.error
									? "Unavailable"
									: "Live"
						}
					/>
					<DetailRow
						label="Balance"
						value={
							espaceBalanceQuery.data
								? `${Number(espaceBalanceQuery.data.formatted).toFixed(4)} ${espaceBalanceQuery.data.symbol}`
								: "—"
						}
					/>
					<DetailRow
						label="Block"
						value={espaceSnapshotQuery.data?.blockNumber ?? "—"}
					/>
					<DetailRow
						label="Mode"
						value="wagmi public client + MetaMask/injected connector"
					/>
					<DetailRow
						label="Session"
						value="Shared auth remains on the eSpace path"
					/>
					{espaceSnapshotQuery.error ? (
						<div className="mt-4 rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-[11px] leading-5 text-error/80">
							{espaceSnapshotQuery.error instanceof Error
								? espaceSnapshotQuery.error.message
								: "eSpace RPC query failed."}
						</div>
					) : null}
				</WalletCard>

				<WalletCard
					title="Core Wallet"
					subtitle="Direct Fluent Core provider calls without wagmi or SIWE coupling."
					badge={
						<StatusBadge
							tone={
								isCoreConnectedAndReady
									? "success"
									: coreWallet.isConnected
										? "warning"
										: coreWallet.isAvailable
											? "warning"
											: "neutral"
							}
							label={
								isCoreConnectedAndReady
									? "Connected"
									: coreWallet.isConnected
										? "Wrong Network"
										: coreWallet.isAvailable
											? "Detected"
											: "Unavailable"
							}
						/>
					}
					actions={
						<>
							<button
								type="button"
								onClick={() => {
									if (!coreWallet.isConnected) {
										void coreWallet.connect();
										return;
									}

									if (isCoreConnectedWrongChain) {
										void coreWallet.switchChain(targetCoreChain);
									}
								}}
								disabled={
									!coreWallet.isAvailable ||
									coreWallet.isConnecting ||
									coreWallet.isSwitching ||
									isCoreConnectedAndReady
								}
								className="btn btn-outline !px-4 !py-2 text-xs"
							>
								{coreWallet.isConnecting
									? "Connecting…"
									: coreWallet.isSwitching
										? "Switching…"
										: coreButtonLabel}
							</button>
							<button
								type="button"
								onClick={() => {
									if (coreWallet.isConnected) {
										coreWallet.disconnect();
									} else {
										void coreWallet.refresh();
										void coreSnapshotQuery.refetch();
									}
								}}
								disabled={!coreWallet.isAvailable || coreWallet.isRefreshing}
								className="btn btn-ghost !px-4 !py-2 text-xs"
							>
								{coreWallet.isConnected
									? "Disconnect"
									: coreWallet.isRefreshing
										? "Refreshing…"
										: "Refresh"}
							</button>
						</>
					}
				>
					<DetailRow label="Provider" value="window.conflux" />
					<DetailRow
						label="Account"
						value={formatAddress(normalizedCoreAddress ?? coreWallet.address)}
					/>
					<DetailRow
						label="Network"
						value={getCoreChainLabel(coreWallet.chainId)}
					/>
					<DetailRow label="Target" value={targetCoreChain.label} />
					<DetailRow
						label="RPC State"
						value={
							coreSnapshotQuery.isLoading
								? "Querying…"
								: coreSnapshotQuery.error
									? "Unavailable"
									: "Live"
						}
					/>
					<DetailRow
						label="Balance"
						value={
							coreSnapshotQuery.data?.balanceCFX
								? `${coreSnapshotQuery.data.balanceCFX} CFX`
								: "—"
						}
					/>
					<DetailRow
						label="Epoch"
						value={coreSnapshotQuery.data?.epochNumber ?? "—"}
					/>
					<DetailRow
						label="Block"
						value={coreSnapshotQuery.data?.blockHeight ?? "—"}
					/>
					<DetailRow
						label="Mode"
						value="cive public client + Fluent provider"
					/>
					{coreWallet.error ? (
						<div className="mt-4 rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-[11px] leading-5 text-error/80">
							{coreWallet.error}
						</div>
					) : null}
					{!coreWallet.error && coreSnapshotQuery.error ? (
						<div className="mt-4 rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-[11px] leading-5 text-error/80">
							{coreSnapshotQuery.error instanceof Error
								? coreSnapshotQuery.error.message
								: "Core RPC query failed."}
						</div>
					) : null}
				</WalletCard>
			</div>
		</section>
	);
}
