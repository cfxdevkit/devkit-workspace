import {
	Button,
	Card,
	SectionHeader,
	StatusBanner,
	TradeTokenField,
} from "@devkit/ui-shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import {
	useAccount,
	useChainId,
	usePublicClient,
	useSwitchChain,
	useWalletClient,
} from "wagmi";
import { confluxLocalESpace } from "../chains";
import type { DexState, TokenInfo } from "../hooks/useDex";
import { VAULT_ABI } from "../hooks/useDex";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

export function Vault({ dex }: { dex: DexState }) {
	const { address, isConnected } = useAccount();
	const chainId = useChainId();
	const { switchChain } = useSwitchChain();
	const publicClient = usePublicClient();
	const { data: walletClient } = useWalletClient();

	const [tokenIdx, setTokenIdx] = useState(0);
	const [amount, setAmount] = useState("");
	const [vaultBal, setVaultBal] = useState("");
	const [status, setStatus] = useState("");

	const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;
	const handleSwitchChain = () => {
		switchChain?.({ chainId: confluxLocalESpace.id });
	};

	const allTokens = useMemo<
		(TokenInfo & { vaultToken: `0x${string}` })[]
	>(() => {
		const baseCfx = dex.tokens.find((token) => token.isNative);
		return [
			{
				address: ZERO_ADDR,
				vaultToken: ZERO_ADDR,
				symbol: "CFX",
				decimals: baseCfx?.decimals ?? 18,
				isNative: true,
				iconUrl: baseCfx?.iconUrl,
			},
			...dex.tokens
				.filter((token) => !token.isNative)
				.map((token) => ({ ...token, vaultToken: token.address })),
		];
	}, [dex.tokens]);

	useEffect(() => {
		if (tokenIdx < allTokens.length) return;
		setTokenIdx(0);
	}, [allTokens.length, tokenIdx]);

	const selected = allTokens[tokenIdx] ?? allTokens[0];

	const refreshBal = useCallback(async () => {
		if (!publicClient || !address || !dex.vault) return;
		try {
			const bal = (await publicClient.readContract({
				address: dex.vault,
				abi: VAULT_ABI,
				functionName: "balanceOf",
				args: [selected.vaultToken, address],
			})) as bigint;
			setVaultBal(formatUnits(bal, selected.decimals));
		} catch {
			setVaultBal("—");
		}
	}, [publicClient, address, dex.vault, selected]);

	useEffect(() => {
		if (dex.vault && address) refreshBal();
	}, [refreshBal, dex.vault, address]);

	if (!isConnected || !dex.vault) {
		return (
			<Card className="relative h-fit overflow-hidden rounded-[2rem] border-white/5 bg-bg-secondary/40 p-6 shadow-2xl backdrop-blur-2xl">
				<div className="absolute top-0 left-0 -ml-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-40" />
				<h2 className="mb-3 text-xl font-black tracking-tight text-white uppercase">
					Vault Control
				</h2>
				<p className="text-sm font-medium leading-relaxed text-text-secondary">
					{!isConnected
						? "Connect developer wallet to authorize vault interactions."
						: "PayableVault protocol synchronization pending."}
				</p>
				{!isConnected && (
					<div className="mt-6 rounded-[1.25rem] border border-white/10 bg-white/5 p-5 shadow-inner backdrop-blur-sm">
						<div className="flex items-center gap-3">
							<span className="h-2 w-2 rounded-full bg-accent animate-pulse shadow-[0_0_8px_currentColor]" />
							<span className="text-[10px] font-black uppercase tracking-[0.2em] text-text-secondary/60 text-center">
								Authorization required for local state access.
							</span>
						</div>
					</div>
				)}
			</Card>
		);
	}

	const handleDeposit = async () => {
		if (isWrongChain) {
			handleSwitchChain();
			return;
		}
		if (!walletClient) {
			setStatus("Switch to Local eSpace");
			return;
		}
		if (!publicClient || !address || !dex.vault) {
			setStatus("Syncing Connection...");
			return;
		}
		if (!amount) {
			setStatus("Amount Required");
			return;
		}
		const amt = parseUnits(amount, selected.decimals);
		setStatus("Preparing Deposit...");
		try {
			if (selected.address === ZERO_ADDR) {
				const hash = await walletClient.writeContract({
					address: dex.vault,
					abi: VAULT_ABI,
					functionName: "depositNative",
					args: [],
					value: amt,
				});
				setStatus("Depositing...");
				await publicClient.waitForTransactionReceipt({ hash });
			} else {
				const approveTx = await walletClient.writeContract({
					address: selected.address,
					abi: erc20Abi,
					functionName: "approve",
					args: [dex.vault, amt],
				});
				await publicClient.waitForTransactionReceipt({ hash: approveTx });
				const hash = await walletClient.writeContract({
					address: dex.vault,
					abi: VAULT_ABI,
					functionName: "deposit",
					args: [selected.vaultToken, amt],
				});
				setStatus("Depositing...");
				await publicClient.waitForTransactionReceipt({ hash });
			}
			await refreshBal();
			dex.refresh();
			setStatus("Deposit Confirmed");
			setTimeout(() => setStatus(""), 5000);
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
			);
		}
	};

	const handleWithdraw = async () => {
		if (isWrongChain) {
			handleSwitchChain();
			return;
		}
		if (!walletClient) {
			setStatus("Switch to Local eSpace");
			return;
		}
		if (!publicClient || !address || !dex.vault) {
			setStatus("Syncing Connection...");
			return;
		}
		if (!amount) {
			setStatus("Amount Required");
			return;
		}
		const amt = parseUnits(amount, selected.decimals);
		setStatus("Preparing Withdrawal...");
		try {
			const hash = await walletClient.writeContract({
				address: dex.vault,
				abi: VAULT_ABI,
				functionName: "withdraw",
				args: [selected.vaultToken, amt],
			});
			setStatus("Withdrawing...");
			await publicClient.waitForTransactionReceipt({ hash });
			await refreshBal();
			dex.refresh();
			setStatus("Withdrawal Confirmed");
			setTimeout(() => setStatus(""), 5000);
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
			);
		}
	};

	return (
		<Card className="relative h-fit overflow-visible rounded-[2rem] border-white/5 bg-bg-secondary/40 p-5 md:p-6 shadow-2xl backdrop-blur-2xl">
			<div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />

			<SectionHeader
				title="Vault"
				titleClassName="text-xl tracking-tight"
				description="Unified asset-parking engine."
				descriptionClassName="text-[11px] text-text-secondary/70"
				right={
					<Button
						onClick={refreshBal}
						variant="secondary"
						className="!h-8 !px-4 !text-[8px] font-black uppercase tracking-[0.18em]"
					>
						Sync
					</Button>
				}
			/>

			<div className="relative mb-8 grid gap-3 grid-cols-2">
				<div className="rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner">
					<div className="text-[8px] font-black uppercase tracking-[0.25em] text-text-secondary/30">
						Active Asset
					</div>
					<div className="mt-1 text-base font-black uppercase tracking-tight text-white">
						{selected.symbol}
					</div>
				</div>
				<div className="rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner">
					<div className="text-[8px] font-black uppercase tracking-[0.25em] text-text-secondary/30">
						Vault Credits
					</div>
					<div className="mt-1 text-base font-black leading-none tracking-tight text-success tabular-nums">
						{vaultBal && vaultBal !== "—"
							? Number(vaultBal).toLocaleString(undefined, {
									maximumFractionDigits: 6,
								})
							: "0.0"}
					</div>
				</div>
			</div>

			<div className="relative flex flex-col gap-6">
				<TradeTokenField
					label="Vault Asset"
					sideLabel={
						vaultBal && vaultBal !== "—"
							? `Credits: ${Number(vaultBal).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
							: "Credits: 0.0"
					}
					amount={amount}
					onAmountChange={setAmount}
					tokens={allTokens}
					selectedIndex={tokenIdx}
					onTokenChange={setTokenIdx}
				/>

				<div className="grid gap-3 sm:grid-cols-2">
					<Button
						onClick={handleDeposit}
						disabled={
							!isConnected || (!isWrongChain && (!walletClient || !amount))
						}
						variant="primary"
						className="h-11 rounded-xl !text-[9px] font-black uppercase tracking-[0.22em] shadow-xl shadow-accent/10"
					>
						{isWrongChain ? "Switch Chain" : "Deposit"}
					</Button>
					<Button
						onClick={handleWithdraw}
						disabled={
							!isConnected || (!isWrongChain && (!walletClient || !amount))
						}
						variant="danger"
						className="h-11 rounded-xl !text-[9px] font-black uppercase tracking-[0.22em]"
					>
						{isWrongChain ? "Switch Chain" : "Withdraw"}
					</Button>
				</div>

				<div className="rounded-xl border border-white/5 bg-white/5 p-3.5 shadow-inner backdrop-blur-sm">
					<div className="flex items-start gap-3">
						<span className="text-accent/40 text-[10px]">💡</span>
						<p className="text-[9px] font-black uppercase tracking-[0.1em] leading-relaxed text-text-secondary/40">
							Vault allows protocol-wide settlements without redundant
							approvals.
						</p>
					</div>
				</div>
			</div>

			{status && (
				<StatusBanner
					message={status}
					tone={
						status.toLowerCase().includes("confirmed")
							? "success"
							: status.toLowerCase().includes("error")
								? "error"
								: "accent"
					}
					className="mt-5"
				/>
			)}
		</Card>
	);
}
