import {
	ConnectButton,
	DevkitStatus,
	FaucetWidget,
	MetricCard,
	ShellOverview,
} from "@devkit/ui-shared";
import { useAccount } from "wagmi";
import { getChainLabel } from "./chains";
import { DualWalletPanel } from "./components/DualWalletPanel";
import { ExampleContract } from "./components/ExampleContract";
import { useDevkitNetworkSync } from "./hooks/useDevkitNetwork";

function ConfluxLogo() {
	return (
		<svg
			viewBox="0 0 1766.6 2212"
			aria-hidden="true"
			className="w-5 h-auto block fill-accent shrink-0 transition-transform duration-500 group-hover:scale-110"
		>
			<path d="M0,1309.5 L879.5,426.3 L1766.6,1317.2 L1766.6,892.7 L887.1,0 L1,895.7 Z" />
			<path d="M203.6,1528.4 L875.6,2212 L1555.4,1528.4 L1348,1317.2 L879.5,1789.6 L626,1528.4 L1090.7,1052.2 L882.4,845.8 Z" />
		</svg>
	);
}

export function App() {
	const { isConnected } = useAccount();
	const { activeChainId, isWrongChain, switchToTargetChain, targetChainId } =
		useDevkitNetworkSync();
	const showFaucet = targetChainId === 2030;
	const targetChainLabel = getChainLabel(targetChainId);

	return (
		<div className="min-h-screen flex flex-col font-sans bg-bg-primary text-text-primary selection:bg-accent/30 selection:text-white">
			{/* Dynamic Background */}
			<div className="fixed inset-0 overflow-hidden pointer-events-none opacity-[0.03] z-0">
				<div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-accent rounded-full blur-[160px]" />
				<div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-success rounded-full blur-[160px]" />
			</div>

			<header className="sticky top-0 z-50 border-b border-white/5 bg-bg-primary/60 backdrop-blur-2xl">
				<div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-5 py-2.5">
					<div className="flex items-center gap-3 cursor-default group">
						<ConfluxLogo />
						<div className="flex flex-col select-none">
							<span className="font-black text-[1.05rem] text-white leading-none tracking-tight uppercase">
								CFX DevKit
							</span>
							<span className="mt-1 text-[8px] font-black uppercase tracking-[0.18em] leading-none text-text-secondary/40 transition-colors group-hover:text-accent/60">
								Project Sandbox
							</span>
						</div>
					</div>
					<div className="flex items-center gap-3">
						{isWrongChain && (
							<button
								type="button"
								onClick={switchToTargetChain}
								className="rounded-lg border border-warning/10 bg-warning/5 px-3.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-warning/80 transition-all hover:bg-warning/10 hover:scale-105 active:scale-95 shadow-md shadow-warning/5"
							>
								{`Switch to ${targetChainLabel}`}
							</button>
						)}
						<ConnectButton />
					</div>
				</div>
			</header>

			<main className="z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-5 py-6 md:py-8">
				<div className="animate-fade-in-up">
					<ShellOverview
						title="Project Sandbox"
						description="High-density interface for smart contract experimentation. This first cross-space pass keeps one app shell while exposing separate eSpace and Core wallet surfaces."
						statusLabel={
							isWrongChain
								? "Network Mismatch"
								: isConnected
									? "Node Active"
									: "Offline"
						}
						statusVariant={
							isWrongChain ? "warning" : isConnected ? "success" : "neutral"
						}
						metrics={
							<>
								<MetricCard
									label="Network Index"
									value={getChainLabel(activeChainId)}
									hint={`Chain ID ${activeChainId}`}
								/>
								<MetricCard
									label="Asset Target"
									value="Counter"
									hint="EVM Standard"
								/>
								<MetricCard
									label="Connectivity"
									value={isConnected ? "Wallet Live" : "Awaiting"}
									hint="Session state"
									variant={isConnected ? "success" : "default"}
								/>
								<MetricCard
									label="Wallet Layout"
									value="Dual Panel"
									hint="eSpace + Core"
								/>
							</>
						}
					/>
				</div>

				<div className="animate-fade-in-up" style={{ animationDelay: "0.05s" }}>
					<DualWalletPanel />
				</div>

				<div className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
					<ExampleContract />
				</div>
			</main>

			<footer className="mt-auto border-t border-white/5 py-5 text-center text-text-secondary/20 text-[8px] font-black uppercase tracking-[0.35em] select-none">
				Conflux Network &bull; DevKit Project Example &bull; 2026
			</footer>

			{showFaucet ? (
				<FaucetWidget>
					<DevkitStatus />
				</FaucetWidget>
			) : null}
		</div>
	);
}
