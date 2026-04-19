import {
	Button,
	SectionHeader,
	StatusBanner,
	TradeActionBar,
	TradeSummaryGrid,
	TradeTokenField,
} from "@devkit/ui-shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, maxUint256, parseUnits } from "viem";
import {
	useAccount,
	useChainId,
	usePublicClient,
	useSwitchChain,
	useWalletClient,
} from "wagmi";
import { confluxLocalESpace } from "../chains";
import type { DexState } from "../hooks/useDex";

const ERC20_ABI = [
	{
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		name: "approve",
		outputs: [{ name: "", type: "bool" }],
		stateMutability: "nonpayable",
		type: "function",
	},
	{
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
		],
		name: "allowance",
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [{ name: "account", type: "address" }],
		name: "balanceOf",
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function",
	},
] as const;

const ROUTER_LP_ABI = [
	{
		inputs: [
			{ name: "token", type: "address" },
			{ name: "amountTokenDesired", type: "uint256" },
			{ name: "amountTokenMin", type: "uint256" },
			{ name: "amountETHMin", type: "uint256" },
			{ name: "to", type: "address" },
			{ name: "deadline", type: "uint256" },
		],
		name: "addLiquidityETH",
		outputs: [
			{ name: "amountToken", type: "uint256" },
			{ name: "amountETH", type: "uint256" },
			{ name: "liquidity", type: "uint256" },
		],
		stateMutability: "payable",
		type: "function",
	},
	{
		inputs: [
			{ name: "tokenA", type: "address" },
			{ name: "tokenB", type: "address" },
			{ name: "amountADesired", type: "uint256" },
			{ name: "amountBDesired", type: "uint256" },
			{ name: "amountAMin", type: "uint256" },
			{ name: "amountBMin", type: "uint256" },
			{ name: "to", type: "address" },
			{ name: "deadline", type: "uint256" },
		],
		name: "addLiquidity",
		outputs: [
			{ name: "amountA", type: "uint256" },
			{ name: "amountB", type: "uint256" },
			{ name: "liquidity", type: "uint256" },
		],
		stateMutability: "nonpayable",
		type: "function",
	},
] as const;

interface Props {
	dex: DexState;
}

function formatAmount(value: number, decimals: number): string {
	if (!Number.isFinite(value)) return "";
	return value.toLocaleString(undefined, {
		maximumFractionDigits: Math.min(6, decimals),
		useGrouping: false,
	});
}

export function AddLiquidity({ dex }: Props) {
	const { address, isConnected } = useAccount();
	const chainId = useChainId();
	const { switchChain } = useSwitchChain();
	const publicClient = usePublicClient();
	const { data: walletClient } = useWalletClient();

	const [tokenAIdx, setTokenAIdx] = useState(1); // first non-CFX token
	const [tokenBIdx, setTokenBIdx] = useState(0); // CFX
	const [amountA, setAmountA] = useState("");
	const [amountB, setAmountB] = useState("");
	const [status, setStatus] = useState("");
	const [loading, setLoading] = useState(false);
	const [balA, setBalA] = useState("");
	const [balB, setBalB] = useState("");
	const [lastEdited, setLastEdited] = useState<"A" | "B">("A");
	const syncingRef = useRef(false);
	const tokens = dex.tokens;
	const tokenA = tokens[tokenAIdx];
	const tokenB = tokens[tokenBIdx];

	const refreshBalances = useCallback(async () => {
		if (!publicClient || !address || !tokenA || !tokenB) return;

		try {
			const balanceA = tokenA.isNative
				? await publicClient.getBalance({ address })
				: await publicClient.readContract({
						address: tokenA.address,
						abi: ERC20_ABI,
						functionName: "balanceOf",
						args: [address],
					});
			const balanceB = tokenB.isNative
				? await publicClient.getBalance({ address })
				: await publicClient.readContract({
						address: tokenB.address,
						abi: ERC20_ABI,
						functionName: "balanceOf",
						args: [address],
					});

			setBalA((Number(balanceA) / 10 ** tokenA.decimals).toFixed(4));
			setBalB((Number(balanceB) / 10 ** tokenB.decimals).toFixed(4));
		} catch {
			// Ignore transient balance read failures.
		}
	}, [publicClient, address, tokenA, tokenB]);
	const pairLabel =
		tokenA && tokenB ? `${tokenA.symbol} / ${tokenB.symbol}` : "Pair";
	const selectedPool = useMemo(() => {
		if (
			!tokenA ||
			!tokenB ||
			tokenA.address.toLowerCase() === tokenB.address.toLowerCase()
		)
			return null;
		return (
			dex.pools.find((pool) => {
				const token0 = pool.token0.address.toLowerCase();
				const token1 = pool.token1.address.toLowerCase();
				const a = tokenA.address.toLowerCase();
				const b = tokenB.address.toLowerCase();
				return (token0 === a && token1 === b) || (token0 === b && token1 === a);
			}) ?? null
		);
	}, [dex.pools, tokenA, tokenB]);

	useEffect(() => {
		void refreshBalances();
	}, [refreshBalances]);

	useEffect(() => {
		if (syncingRef.current || !selectedPool || !tokenA || !tokenB) return;
		if (tokenA.address.toLowerCase() === tokenB.address.toLowerCase()) return;

		const poolToken0MatchesA =
			selectedPool.token0.address.toLowerCase() ===
			tokenA.address.toLowerCase();
		const reserveA = Number(
			formatUnits(
				poolToken0MatchesA ? selectedPool.reserve0 : selectedPool.reserve1,
				tokenA.decimals,
			),
		);
		const reserveB = Number(
			formatUnits(
				poolToken0MatchesA ? selectedPool.reserve1 : selectedPool.reserve0,
				tokenB.decimals,
			),
		);
		if (
			!Number.isFinite(reserveA) ||
			!Number.isFinite(reserveB) ||
			reserveA <= 0 ||
			reserveB <= 0
		)
			return;

		if (lastEdited === "A" && amountA) {
			const parsed = Number(amountA);
			if (!Number.isFinite(parsed) || parsed < 0) return;
			syncingRef.current = true;
			setAmountB(formatAmount((parsed * reserveB) / reserveA, tokenB.decimals));
			syncingRef.current = false;
			return;
		}

		if (lastEdited === "B" && amountB) {
			const parsed = Number(amountB);
			if (!Number.isFinite(parsed) || parsed < 0) return;
			syncingRef.current = true;
			setAmountA(formatAmount((parsed * reserveA) / reserveB, tokenA.decimals));
			syncingRef.current = false;
		}
	}, [amountA, amountB, lastEdited, selectedPool, tokenA, tokenB]);

	const handleAmountAChange = (value: string) => {
		setLastEdited("A");
		setAmountA(value);
		if (!value) setAmountB("");
	};

	const handleAmountBChange = (value: string) => {
		setLastEdited("B");
		setAmountB(value);
		if (!value) setAmountA("");
	};

	const handleTokenAChange = (nextIndex: number) => {
		setTokenAIdx(nextIndex);
		if (nextIndex === tokenBIdx) {
			setTokenBIdx(tokenAIdx);
		}
	};

	const handleTokenBChange = (nextIndex: number) => {
		setTokenBIdx(nextIndex);
		if (nextIndex === tokenAIdx) {
			setTokenAIdx(tokenBIdx);
		}
	};

	const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;
	const handleSwitchChain = () => {
		switchChain?.({ chainId: confluxLocalESpace.id });
	};

	const handleAdd = async () => {
		if (isWrongChain) {
			handleSwitchChain();
			return;
		}
		const routerAddress = dex.router;
		if (
			!walletClient ||
			!publicClient ||
			!address ||
			!tokenA ||
			!tokenB ||
			!routerAddress
		)
			return;
		if (!amountA || !amountB) {
			setStatus("Details missing");
			return;
		}

		setLoading(true);
		setStatus("Preparing protocol seed...");

		try {
			const aWei = parseUnits(amountA, tokenA.decimals);
			const bWei = parseUnits(amountB, tokenB.decimals);
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

			const isNativeB = !!tokenB.isNative;
			const isNativeA = !!tokenA.isNative;

			if (isNativeA || isNativeB) {
				const token = isNativeA ? tokenB : tokenA;
				const tokenAmt = isNativeA ? bWei : aWei;
				const ethAmt = isNativeA ? aWei : bWei;

				setStatus("Authorizing assets...");
				const approveHash = await walletClient.writeContract({
					address: token.address,
					abi: ERC20_ABI,
					functionName: "approve",
					args: [routerAddress, maxUint256],
				});
				await publicClient.waitForTransactionReceipt({ hash: approveHash });

				setStatus("Providing liquidity...");
				const hash = await walletClient.writeContract({
					address: routerAddress,
					abi: ROUTER_LP_ABI,
					functionName: "addLiquidityETH",
					args: [token.address, tokenAmt, 0n, 0n, address, deadline],
					value: ethAmt,
				});
				await publicClient.waitForTransactionReceipt({ hash });
			} else {
				setStatus("Authorizing assets...");
				const [h1, h2] = await Promise.all([
					walletClient.writeContract({
						address: tokenA.address,
						abi: ERC20_ABI,
						functionName: "approve",
						args: [routerAddress, maxUint256],
					}),
					walletClient.writeContract({
						address: tokenB.address,
						abi: ERC20_ABI,
						functionName: "approve",
						args: [routerAddress, maxUint256],
					}),
				]);
				await Promise.all([
					publicClient.waitForTransactionReceipt({ hash: h1 }),
					publicClient.waitForTransactionReceipt({ hash: h2 }),
				]);

				setStatus("Providing liquidity...");
				const hash = await walletClient.writeContract({
					address: routerAddress,
					abi: ROUTER_LP_ABI,
					functionName: "addLiquidity",
					args: [
						tokenA.address,
						tokenB.address,
						aWei,
						bWei,
						0n,
						0n,
						address,
						deadline,
					],
				});
				await publicClient.waitForTransactionReceipt({ hash });
			}

			setStatus("✓ Protocol seed confirmed");
			setAmountA("");
			setAmountB("");
			dex.refresh();
			setTimeout(() => setStatus(""), 5000);
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message.slice(0, 80) : "failed"}`,
			);
		} finally {
			setLoading(false);
		}
	};

	if (!isConnected || tokens.length < 2) {
		return (
			<div className="rounded-[1.5rem] border border-white/5 bg-bg-secondary/40 p-6 backdrop-blur-2xl shadow-lg relative overflow-hidden">
				<div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />
				<h2 className="text-xl font-black tracking-tighter text-white uppercase mb-2">
					Liquidity
				</h2>
				<p className="text-[11px] text-text-secondary/60 font-medium leading-relaxed italic opacity-80">
					{!isConnected
						? "Connect wallet to authorize protocol seeding."
						: "No tradable assets indexed in this environment."}
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-visible">
			<div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />

			<SectionHeader
				className="mb-8"
				title="Provide"
				description="Seed depth into local AMM pools."
				right={
					<div className="flex items-center gap-1.5 rounded-xl border border-accent/20 bg-accent/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-accent/60 shadow-inner italic">
						<span className="h-1 w-1 rounded-full bg-accent animate-pulse" />
						{pairLabel}
					</div>
				}
			/>

			<div className="relative flex flex-col gap-2">
				<TradeTokenField
					label="Asset A"
					sideLabel={balA ? `Account: ${balA}` : "Init Asset"}
					amount={amountA}
					onAmountChange={handleAmountAChange}
					tokens={tokens}
					selectedIndex={tokenAIdx}
					onTokenChange={handleTokenAChange}
				/>

				<div className="relative z-20 -my-4 flex justify-center">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl border-[4px] border-bg-secondary bg-bg-tertiary shadow-xl group">
						<span className="text-lg font-black text-accent drop-shadow-[0_0_8px_rgba(79,142,255,0.4)]">
							+
						</span>
					</div>
				</div>

				<TradeTokenField
					label="Asset B"
					sideLabel={balB ? `Account: ${balB}` : "Init Asset"}
					amount={amountB}
					onAmountChange={handleAmountBChange}
					tokens={tokens}
					selectedIndex={tokenBIdx}
					onTokenChange={handleTokenBChange}
				/>

				<div className="mt-6 flex flex-col gap-4">
					<TradeSummaryGrid
						items={[
							{
								label: "Active Interface",
								value:
									tokenA?.isNative || tokenB?.isNative
										? "addLiquidityETH"
										: "addLiquidity",
							},
							{
								label: "Symmetry",
								value: selectedPool ? "Balanced" : "Manual",
							},
							{ label: "Type", value: "V2 Pooled", tone: "accent" },
							{ label: "Network", value: "eSpace" },
						]}
					/>

					<TradeActionBar>
						<div className="max-w-[300px] text-[9px] font-black uppercase tracking-[0.1em] leading-relaxed text-text-secondary/40 italic">
							Provisioning liquidity mints LP tokens to the authorized account
							instantly.
						</div>
						<Button
							onClick={isWrongChain ? handleSwitchChain : handleAdd}
							disabled={
								loading ||
								(!isWrongChain &&
									(!amountA || !amountB || tokenAIdx === tokenBIdx))
							}
							variant={isWrongChain ? "secondary" : "primary"}
							className="h-12 min-w-[200px] text-[10px] font-black uppercase tracking-[0.25em] rounded-xl shadow-xl shadow-accent/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
						>
							{isWrongChain
								? "Switch to eSpace"
								: loading
									? "Syncing..."
									: tokenAIdx === tokenBIdx
										? "Invalid Pair"
										: "Execute Supply"}
						</Button>
					</TradeActionBar>
				</div>
			</div>

			{status && (
				<StatusBanner
					message={status}
					tone={
						status.includes("✓")
							? "success"
							: status.includes("Error")
								? "error"
								: "accent"
					}
					className="mt-4 px-5 py-3"
					textClassName="leading-none"
				/>
			)}
		</div>
	);
}
