import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

const AMOUNTS = [10, 50, 100, 500];

export function Faucet() {
	const { address, isConnected } = useAccount();
	const [status, setStatus] = useState("");
	const [loading, setLoading] = useState(false);
	const [faucetBalance, setFaucetBalance] = useState<number | null>(null);

	const refreshFaucetBalance = useCallback(async () => {
		try {
			const r = await fetch(`/api/accounts/faucet`, {
				signal: AbortSignal.timeout(5000),
			});
			if (!r.ok) return;
			const data = await r.json();
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
		setStatus(`Funding ${amount} CFX…`);
		try {
			const res = await fetch(`/api/accounts/fund`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ address, amount: String(amount), chain: "evm" }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error || body.detail || `HTTP ${res.status}`);
			}
			setStatus(`✓ Funded ${amount} CFX`);
			setTimeout(refreshFaucetBalance, 2000);
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
			<div className="card">
				<h2 className="text-[1.15rem] font-bold text-gray-200 mb-2">Faucet</h2>
				<p className="text-sm text-text-secondary">
					Connect wallet to use faucet
				</p>
			</div>
		);
	}

	return (
		<div className="card">
			<div className="flex items-center gap-3 mb-2">
				<h2 className="text-[1.15rem] font-bold text-gray-200">Faucet</h2>
				{faucetBalance != null && (
					<span className="bg-success/10 text-success px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border border-success/20">
						{faucetBalance.toLocaleString(undefined, {
							maximumFractionDigits: 0,
						})}{" "}
						CFX available
					</span>
				)}
			</div>
			<p className="text-sm text-text-secondary mb-4">
				Fund your wallet with test CFX from the local server
			</p>

			<div className="flex gap-2 flex-wrap sm:flex-nowrap">
				{AMOUNTS.map((amt) => {
					const insufficient = faucetBalance != null && faucetBalance < amt;
					return (
						<button
							type="button"
							key={amt}
							onClick={() => fund(amt)}
							disabled={loading || insufficient}
							className={`flex-1 py-1.5 px-3 rounded-lg border font-semibold text-sm transition-all
                ${
									insufficient
										? "border-border bg-transparent text-text-secondary opacity-50 cursor-not-allowed"
										: "border-success/30 bg-success/10 text-success hover:bg-success/20 hover:border-success/50 active:scale-95"
								}`}
							title={
								insufficient ? "Insufficient faucet balance" : `Fund ${amt} CFX`
							}
						>
							<span className="tabular-nums">{amt}</span> CFX
						</button>
					);
				})}
			</div>

			{status && (
				<p
					className={`text-sm mt-3 animate-fade-in ${status.startsWith("✓") ? "text-success" : status.startsWith("Error") ? "text-error" : "text-text-secondary"}`}
				>
					{status}
				</p>
			)}
		</div>
	);
}
