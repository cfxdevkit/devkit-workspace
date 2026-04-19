import { useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useAuth } from "../hooks/useAuth";

/**
 * A premium Wallet Connection widget with high-density layout.
 * Standardized for the DevKit monorepo.
 */
export function ConnectButton() {
	const { address, isConnected } = useAccount();
	const { connect, isPending: isConnecting } = useConnect();
	const { disconnect } = useDisconnect();
	const {
		isAuthenticated,
		isLoading: isSigning,
		error,
		signIn,
		signOut,
	} = useAuth();
	const { data: balance } = useBalance({
		address,
		query: { enabled: !!address, refetchInterval: 8000 },
	});
	const [copied, setCopied] = useState(false);
	const shortAddress = address
		? `${address.slice(0, 6)}…${address.slice(-4)}`
		: "";

	const copyAddress = () => {
		if (!address) return;
		navigator.clipboard.writeText(address).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		});
	};

	// State 1: Disconnected
	if (!isConnected) {
		return (
			<button
				type="button"
				onClick={() => connect({ connector: injected() })}
				disabled={isConnecting}
				className="btn btn-secondary !px-4 !py-2 text-sm group"
			>
				<div className="relative overflow-hidden w-4 h-4 mr-1">
					<span className="absolute inset-0 flex items-center justify-center text-accent transition-transform duration-300 group-hover:-translate-y-5">
						⬡
					</span>
					<span className="absolute inset-0 flex items-center justify-center text-accent translate-y-5 transition-transform duration-300 group-hover:translate-y-0">
						⬢
					</span>
				</div>
				<span>{isConnecting ? "Connecting…" : "Connect Wallet"}</span>
			</button>
		);
	}

	// State 2: Connected, SIWE in progress / failed
	if (!isAuthenticated) {
		return (
			<div className="flex items-center gap-2 p-1 pl-3 h-10 rounded-xl bg-warning/5 border border-warning/20 backdrop-blur-md">
				<div className="flex items-center gap-2">
					<span className="relative flex h-2 w-2">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
					</span>
					<span className="font-mono text-[11px] font-bold text-warning">
						{shortAddress}
					</span>
				</div>
				<div className="w-[1px] h-4 bg-warning/20 mx-1" />
				{isSigning ? (
					<span className="text-warning/60 text-[10px] font-bold uppercase tracking-widest px-2 animate-pulse">
						Signing…
					</span>
				) : (
					<button
						type="button"
						onClick={() => void signIn()}
						className="h-8 px-3 rounded-lg bg-warning text-bg-primary text-[10px] font-bold uppercase tracking-wider hover:bg-warning/80 transition-all active:scale-95"
					>
						{error ? "Retry" : "Sign In"}
					</button>
				)}
			</div>
		);
	}

	// State 3: Authenticated
	return (
		<div className="flex items-center gap-2">
			<div className="group relative flex items-center gap-0 h-11 rounded-2xl bg-bg-secondary/40 border border-border/50 backdrop-blur-xl shadow-lg transition-all hover:border-border-hover/80 hover:bg-bg-secondary/60">
				{/* Address / Copy Button */}
				<button
					type="button"
					onClick={copyAddress}
					className="flex flex-col items-start px-4 h-full justify-center transition-all hover:bg-white/5 first:rounded-l-2xl"
					title={address}
				>
					<div className="flex items-center gap-2">
						<div className="relative">
							<span className="block w-2 h-2 rounded-full bg-success" />
							<span className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-40" />
						</div>
						<span className="font-mono text-xs font-bold text-text-primary tracking-tight">
							{shortAddress}
						</span>
					</div>
					<div className="text-[9px] font-bold text-text-secondary uppercase tracking-[0.1em] mt-0.5 flex items-center gap-1">
						{copied ? (
							<span className="text-success flex items-center gap-1">
								<svg
									className="w-2.5 h-2.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
									focusable="false"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="3"
										d="M5 13l4 4L19 7"
									/>
								</svg>
								Copied
							</span>
						) : (
							<span className="flex items-center gap-1 transition-colors group-hover:text-accent">
								<svg
									className="w-2.5 h-2.5"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
									focusable="false"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2.5"
										d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2"
									/>
								</svg>
								Click to Copy
							</span>
						)}
					</div>
				</button>

				<div className="w-[1px] h-6 bg-border/40" />

				{/* Balance Display */}
				{balance && (
					<div className="hidden sm:flex flex-col items-end px-4 h-full justify-center">
						<div className="text-[9px] font-bold text-text-secondary uppercase tracking-[0.15em] leading-none mb-1">
							Available
						</div>
						<div className="flex items-baseline gap-1">
							<span className="text-sm font-mono font-bold text-text-primary leading-none">
								{Number(balance.formatted).toLocaleString(undefined, {
									maximumFractionDigits: 4,
								})}
							</span>
							<span className="text-[10px] font-bold text-accent tracking-tighter">
								CFX
							</span>
						</div>
					</div>
				)}

				{/* Action Button Container (Logout) */}
				<div className="h-full flex items-center pr-1 ml-1">
					<button
						type="button"
						onClick={() => {
							signOut();
							disconnect();
						}}
						className="h-8 w-8 flex items-center justify-center rounded-xl text-text-secondary hover:bg-error/10 hover:text-error transition-all active:scale-90"
						title="Sign out & Disconnect"
					>
						<svg
							className="w-4 h-4"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<title>Disconnect wallet</title>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
							/>
						</svg>
					</button>
				</div>
			</div>
		</div>
	);
}
