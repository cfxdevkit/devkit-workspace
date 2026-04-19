import {
	Card,
	DevkitStatus,
	FaucetWidget,
	MetricCard,
	SegmentedControl,
	ShellOverview,
} from "@devkit/ui-shared";
import { useMemo, useState } from "react";
import { AddLiquidity } from "./components/AddLiquidity";
import { CreateToken } from "./components/CreateToken";
import { NavBar } from "./components/NavBar";
import { PoolImportManager } from "./components/PoolImportManager";
import { Pools } from "./components/Pools";
import { Swap } from "./components/Swap";
import { TokenBalances } from "./components/TokenBalances";
import { TokenIconManager } from "./components/TokenIconManager";
import { Vault } from "./components/Vault";
import { useDex } from "./hooks/useDex";

type SectionId = "trade" | "portfolio" | "pools" | "tools";
type TradeAction = "swap" | "liquidity";
type ToolTab = "forge" | "vault" | "imports" | "icons";

function ShellSectionButton({
	active,
	label,
	meta,
	onClick,
}: {
	active: boolean;
	label: string;
	meta: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`group relative overflow-hidden rounded-[1.35rem] border px-4 py-2.5 text-left transition-all duration-300 ${
				active
					? "border-accent/40 bg-accent/10 text-white shadow-xl shadow-accent/10"
					: "border-white/5 bg-bg-secondary/40 text-text-secondary hover:border-white/20 hover:bg-bg-secondary/60 backdrop-blur-sm"
			}`}
		>
			<div
				className={`text-[13px] font-black tracking-tight transition-colors ${active ? "text-white" : "group-hover:text-text-primary uppercase"}`}
			>
				{label}
			</div>
			<div
				className={`mt-0.5 text-[8px] font-black uppercase tracking-[0.18em] transition-colors ${active ? "text-accent/80" : "text-text-secondary/30 group-hover:text-text-secondary/50"}`}
			>
				{meta}
			</div>
			{active && (
				<div className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-accent to-transparent opacity-50" />
			)}
		</button>
	);
}

export function App() {
	const dex = useDex();
	const [activeSection, setActiveSection] = useState<SectionId>("trade");
	const [tradeAction, setTradeAction] = useState<TradeAction>("swap");
	const [toolTab, setToolTab] = useState<ToolTab>("forge");

	const sectionMeta = useMemo(
		() => ({
			trade: `${dex.tokens.length || 0} Assets`,
			portfolio: "Inventory",
			pools: `${dex.pools.length || 0} Pools`,
			tools: "Admin",
		}),
		[dex.pools.length, dex.tokens.length],
	);

	const dexReady = !!dex.router && !!dex.factory && !!dex.weth;

	return (
		<div className="min-h-screen flex flex-col font-sans bg-bg-primary text-text-primary selection:bg-accent/30 selection:text-white">
			<div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
				<div className="absolute top-[10%] left-[-5%] w-[35%] h-[35%] bg-accent/10 rounded-full blur-[140px]" />
				<div className="absolute bottom-[5%] right-[-5%] w-[40%] h-[40%] bg-success/5 rounded-full blur-[140px]" />
			</div>

			<NavBar />

			<main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-5 py-6 md:py-8">
				<div className="animate-fade-in-up">
					<ShellOverview
						title="DEX Playground"
						description="High-fidelity local trading harness for eSpace development. Manage swaps, liquidity seeding, and protocol-wide asset vaulting in a single unified interface."
						statusLabel={
							dexReady ? "Protocol Active" : "Synchronization Pending"
						}
						statusVariant={dexReady ? "success" : "warning"}
						metrics={
							<>
								<MetricCard
									label="Latency"
									value="Local"
									hint="Sub-ms updates"
								/>
								<MetricCard
									label="Factory"
									value="Uniswap V2"
									hint="AMM engine"
								/>
								<MetricCard label="Chain" value="2030" hint="Local eSpace" />
							</>
						}
					/>
				</div>

				<section
					className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 animate-fade-in-up"
					style={{ animationDelay: "0.1s" }}
				>
					<ShellSectionButton
						active={activeSection === "trade"}
						label="Trade"
						meta={sectionMeta.trade}
						onClick={() => setActiveSection("trade")}
					/>
					<ShellSectionButton
						active={activeSection === "portfolio"}
						label="Portfolio"
						meta={sectionMeta.portfolio}
						onClick={() => setActiveSection("portfolio")}
					/>
					<ShellSectionButton
						active={activeSection === "pools"}
						label="Pools"
						meta={sectionMeta.pools}
						onClick={() => setActiveSection("pools")}
					/>
					<ShellSectionButton
						active={activeSection === "tools"}
						label="Tools"
						meta={sectionMeta.tools}
						onClick={() => setActiveSection("tools")}
					/>
				</section>

				<div className="animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
					{activeSection === "trade" && (
						<section className="grid gap-5 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
							<div className="flex flex-col gap-5">
								<Card className="border-white/5 p-5">
									<div className="mb-5 flex items-center justify-between gap-3">
										<div>
											<h2 className="text-lg font-black text-white uppercase tracking-tight">
												Analytics
											</h2>
											<p className="mt-0.5 text-[10px] text-text-secondary/60 font-black uppercase tracking-widest italic">
												Node Diagnostics
											</p>
										</div>
										<button
											type="button"
											onClick={dex.refresh}
											className="btn btn-secondary !h-8 !px-3 !text-[8px] font-black uppercase tracking-[0.2em]"
										>
											Refresh
										</button>
									</div>

									<div className="grid gap-2.5">
										<MetricCard
											label="DEX Pairs"
											value={String(dex.pools.length)}
											hint="Liquidity Index"
										/>
										<MetricCard
											label="Tokens"
											value={String(dex.tokens.length)}
											hint="Tracked Assets"
										/>
										<MetricCard
											label="Status"
											value={
												dex.error ? "Error" : dex.loading ? "Sync" : "Ready"
											}
											hint={dex.error ?? "All nodes active"}
											variant={dex.error ? "default" : "success"}
										/>
									</div>
								</Card>
							</div>

							<div className="flex flex-col gap-5">
								<div className="flex justify-start">
									<SegmentedControl
										activeId={tradeAction}
										onChange={(id) => setTradeAction(id as TradeAction)}
										options={[
											{ id: "swap", label: "Swap" },
											{ id: "liquidity", label: "Provide" },
										]}
										className="max-w-[220px]"
									/>
								</div>

								<div className="transition-all duration-500">
									{tradeAction === "swap" ? (
										<Swap dex={dex} />
									) : (
										<AddLiquidity dex={dex} />
									)}
								</div>
							</div>
						</section>
					)}

					{activeSection === "portfolio" && (
						<section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
							<TokenBalances tokens={dex.tokens} />
							<div className="flex flex-col gap-5">
								<Card className="border-white/5 h-fit sticky top-24 p-5">
									<h2 className="text-lg font-black text-white uppercase tracking-tight">
										Inventory
									</h2>
									<p className="mt-3 text-[11px] leading-relaxed text-text-secondary/60 font-medium italic">
										Real-time balance tracking for all deployed tokens in the
										local sandbox range.
									</p>
									<div className="mt-5 grid gap-2.5">
										<MetricCard
											label="Visibility"
											value="Partial"
											hint="Local assets only"
										/>
										<MetricCard
											label="Frequency"
											value="10s"
											hint="Auto-sync active"
										/>
									</div>
								</Card>
							</div>
						</section>
					)}

					{activeSection === "pools" && (
						<section>
							<Pools dex={dex} />
						</section>
					)}

					{activeSection === "tools" && (
						<section className="grid gap-5">
							<div className="flex justify-start">
								<SegmentedControl
									activeId={toolTab}
									onChange={(id) => setToolTab(id as ToolTab)}
									options={[
										{ id: "forge", label: "Forge" },
										{ id: "vault", label: "Vault" },
										{ id: "imports", label: "Import Pools" },
										{ id: "icons", label: "Icon Control" },
									]}
									className="max-w-[560px]"
								/>
							</div>

							<div className="transition-all duration-500">
								{toolTab === "forge" && <CreateToken dex={dex} />}
								{toolTab === "vault" && <Vault dex={dex} />}
								{toolTab === "imports" && <PoolImportManager />}
								{toolTab === "icons" && <TokenIconManager dex={dex} />}
							</div>
						</section>
					)}
				</div>
			</main>

			<footer className="mt-auto border-t border-white/5 py-6 text-center text-text-secondary/30 text-[9px] font-black uppercase tracking-[0.35em] italic">
				DevKit Monorepo &bull; Sandbox V2 &bull; 2026
			</footer>

			<FaucetWidget>
				<DevkitStatus />
			</FaucetWidget>
		</div>
	);
}
