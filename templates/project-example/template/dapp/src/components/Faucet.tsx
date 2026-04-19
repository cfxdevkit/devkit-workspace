import { StatusBanner } from "@devkit/ui-shared";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { appUrl } from "../app-base";

const AMOUNTS = [10, 50, 100, 500];

export function Faucet() {
	const { address, isConnected } = useAccount();
	const [status, setStatus] = useState("");
	const [loading, setLoading] = useState(false);
	const [faucetBalance, setFaucetBalance] = useState<number | null>(null);

	// Fetch the faucet account balance from devkit API (dedicated faucet endpoint)
	const refreshFaucetBalance = useCallback(async () => {
		try {
			const r = await fetch(appUrl("devkit/api/accounts/faucet"), {
				signal: AbortSignal.timeout(5000),
			});
			if (!r.ok) return;
			const data = await r.json();
			// devkit returns { coreAddress, evmAddress, coreBalance, evmBalance }
			const raw = data?.coreBalance ?? data?.evmBalance;
			if (raw != null) {
				setFaucetBalance(Number(raw));
			}
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		refreshFaucetBalance();
		const iv = setInterval(refreshFaucetBalance, 15_000);
		return () => clearInterval(iv);
	}, [refreshFaucetBalance]);

	const fund = async (amount: number) => {
		if (!address) return;
		setLoading(true);
		setStatus(`Fund Authorization…`);
		try {
			const res = await fetch(appUrl("devkit/api/accounts/fund"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ address, amount: String(amount), chain: "evm" }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || body.detail || `HTTP ${res.status}`);
			}
			setStatus(`✓ Funded ${amount} CFX`);
			// Refresh faucet balance after funding
			setTimeout(refreshFaucetBalance, 2000);
			setTimeout(() => setStatus(""), 5000);
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
			);
		} finally {
			setLoading(false);
		}
	};

	if (!isConnected) {
		return (
			<div className="rounded-xl border border-white/5 bg-bg-secondary/40 p-4 backdrop-blur-2xl">
				<h2 className="text-[10px] font-black tracking-widest text-text-secondary/60 uppercase mb-2 italic">
					Treasury Access
				</h2>
				<p className="text-[10px] text-text-secondary/30 font-bold uppercase italic tracking-tighter">
					Connect wallet to authorize emission.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-2xl border border-white/5 bg-bg-secondary/40 p-5 backdrop-blur-2xl transition-all hover:bg-bg-secondary/60">
			<div className="flex items-center justify-between gap-4 mb-4">
				<div>
					<h2 className="text-xs font-black tracking-widest text-white uppercase leading-none">
						Faucet
					</h2>
					<p className="mt-1 text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">
						On-demand treasury.
					</p>
				</div>
				{faucetBalance != null && (
					<div className="flex items-center gap-1.5 px-2 py-1 rounded bg-success/5 border border-success/10 shadow-sm italic">
						<span className="h-1 w-1 rounded-full bg-success animate-pulse" />
						<span className="text-[8px] font-bold uppercase tracking-widest text-success/60">
							{faucetBalance.toLocaleString(undefined, {
								maximumFractionDigits: 0,
							})}{" "}
							PL
						</span>
					</div>
				)}
			</div>

			<div className="grid grid-cols-2 gap-2 mb-4">
				{AMOUNTS.map((amt) => {
					const insufficient = faucetBalance != null && faucetBalance < amt;
					return (
						<button
							type="button"
							key={amt}
							onClick={() => fund(amt)}
							disabled={loading || insufficient}
							className="group relative flex flex-col items-center justify-center h-10 rounded-lg border border-white/5 bg-white/[0.03] transition-all hover:border-success/30 hover:bg-white/[0.06] disabled:opacity-20 disabled:cursor-not-allowed overflow-hidden shadow-sm"
							title={
								insufficient ? "Insufficient faucet balance" : `Fund ${amt} CFX`
							}
						>
							<div className="relative font-mono text-[10px] font-black text-white/90 tracking-widest">
								{amt} CFX
							</div>
						</button>
					);
				})}
			</div>
			{status ? (
				<StatusBanner
					message={status}
					tone={
						status.startsWith("✓")
							? "success"
							: status.startsWith("Error")
								? "error"
								: "accent"
					}
				/>
			) : null}
		</div>
	);
}
