import {
	Button,
	Card,
	SectionHeader,
	StatusBanner,
	TradeActionBar,
	TradeSummaryGrid,
	TradeTokenField,
} from "@devkit/ui-shared";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import {
	useAccount,
	useChainId,
	usePublicClient,
	useSwitchChain,
	useWalletClient,
} from "wagmi";
import { confluxLocalESpace } from "../chains";
import type { DexState, PoolInfo } from "../hooks/useDex";
import { ROUTER_ABI } from "../hooks/useDex";

interface QuoteDetails {
	amountOut: bigint;
	route: `0x${string}`[];
	routeSymbols: string[];
	minimumReceived: string;
	executionPrice: number | null;
	priceImpactPct: number | null;
	feePct: number;
	hops: Array<{
		label: string;
		amountOut: string;
		executionPrice: string;
		priceImpact: string;
	}>;
}

async function buildPath(
	from: `0x${string}`,
	to: `0x${string}`,
	publicClient: ReturnType<typeof usePublicClient>,
	dex: DexState,
): Promise<`0x${string}`[]> {
	const direct = [from, to] as `0x${string}`[];
	if (!publicClient || !dex.router) return direct;
	if (
		dex.weth &&
		(from.toLowerCase() === dex.weth.toLowerCase() ||
			to.toLowerCase() === dex.weth.toLowerCase())
	) {
		return direct;
	}
	try {
		await publicClient.readContract({
			address: dex.router,
			abi: ROUTER_ABI,
			functionName: "getAmountsOut",
			args: [1n, direct],
		});
		return direct;
	} catch {
		if (dex.weth) return [from, dex.weth, to];
		return direct;
	}
}

function getPoolForPair(
	dex: DexState,
	from: `0x${string}`,
	to: `0x${string}`,
): PoolInfo | undefined {
	return dex.pools.find((pool) => {
		const token0 = pool.token0.address.toLowerCase();
		const token1 = pool.token1.address.toLowerCase();
		return (
			(token0 === from.toLowerCase() && token1 === to.toLowerCase()) ||
			(token0 === to.toLowerCase() && token1 === from.toLowerCase())
		);
	});
}

function simulateRouteExact(
	dex: DexState,
	path: `0x${string}`[],
	amountIn: bigint,
): {
	amountOut: bigint;
	routeSymbols: string[];
	executionPrice: number | null;
	priceImpactPct: number | null;
	hops: QuoteDetails["hops"];
} | null {
	let currentAmountIn = amountIn;
	let cumulativeSpotPrice = 1;
	const routeSymbols: string[] = [];
	const hops: QuoteDetails["hops"] = [];

	for (let index = 0; index < path.length - 1; index++) {
		const from = path[index];
		const to = path[index + 1];
		const pool = getPoolForPair(dex, from, to);
		if (!pool) return null;

		const fromIsToken0 =
			pool.token0.address.toLowerCase() === from.toLowerCase();
		const inToken = fromIsToken0 ? pool.token0 : pool.token1;
		const outToken = fromIsToken0 ? pool.token1 : pool.token0;
		const reserveInRaw = fromIsToken0 ? pool.reserve0 : pool.reserve1;
		const reserveOutRaw = fromIsToken0 ? pool.reserve1 : pool.reserve0;
		const amountInWithFee = currentAmountIn * 997n;
		const amountOut =
			(amountInWithFee * reserveOutRaw) /
			(reserveInRaw * 1000n + amountInWithFee);

		const reserveIn = Number(reserveInRaw) / 10 ** inToken.decimals;
		const reserveOut = Number(reserveOutRaw) / 10 ** outToken.decimals;
		const amountInDisplay = Number(
			formatUnits(currentAmountIn, inToken.decimals),
		);
		const amountOutDisplay = Number(formatUnits(amountOut, outToken.decimals));
		const spotPrice = reserveIn > 0 ? reserveOut / reserveIn : 0;
		const executionPrice =
			amountInDisplay > 0 ? amountOutDisplay / amountInDisplay : 0;
		const hopImpact =
			spotPrice > 0
				? Math.max(((spotPrice - executionPrice) / spotPrice) * 100, 0)
				: 0;

		cumulativeSpotPrice *= spotPrice;
		routeSymbols.push(inToken.symbol);
		hops.push({
			label: `${inToken.symbol} → ${outToken.symbol}`,
			amountOut: `${amountOutDisplay.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${outToken.symbol}`,
			executionPrice:
				executionPrice > 0
					? `${executionPrice.toFixed(6)} ${outToken.symbol}/${inToken.symbol}`
					: "—",
			priceImpact: formatPct(hopImpact),
		});

		currentAmountIn = amountOut;

		if (index === path.length - 2) {
			routeSymbols.push(outToken.symbol);
		}
	}

	const totalAmountOut = currentAmountIn;
	const totalAmountOutDisplay = Number(
		formatUnits(
			totalAmountOut,
			dex.tokens.find(
				(token) =>
					token.address.toLowerCase() === path[path.length - 1].toLowerCase(),
			)?.decimals ?? 18,
		),
	);
	const totalAmountInDisplay = Number(
		formatUnits(
			amountIn,
			dex.tokens.find(
				(token) => token.address.toLowerCase() === path[0].toLowerCase(),
			)?.decimals ?? 18,
		),
	);
	const executionPrice =
		totalAmountInDisplay > 0
			? totalAmountOutDisplay / totalAmountInDisplay
			: null;
	const priceImpactPct =
		executionPrice != null && cumulativeSpotPrice > 0
			? Math.max(
					((cumulativeSpotPrice - executionPrice) / cumulativeSpotPrice) * 100,
					0,
				)
			: null;

	return {
		amountOut: totalAmountOut,
		routeSymbols,
		executionPrice,
		priceImpactPct,
		hops,
	};
}

function formatPct(value: number | null): string {
	if (value == null || !Number.isFinite(value)) return "—";
	return `${value.toFixed(value >= 1 ? 2 : 3)}%`;
}

function minOutWithSlippage(amountOut: bigint, slippagePct: number): bigint {
	const basisPoints = BigInt(Math.max(0, Math.round(slippagePct * 100)));
	return (amountOut * (10000n - basisPoints)) / 10000n;
}

export function Swap({ dex }: { dex: DexState }) {
	const { address, isConnected } = useAccount();
	const chainId = useChainId();
	const { switchChain } = useSwitchChain();
	const publicClient = usePublicClient();
	const { data: walletClient } = useWalletClient();

	const [fromIdx, setFromIdx] = useState(0);
	const [toIdx, setToIdx] = useState(1);
	const [amount, setAmount] = useState("");
	const [slippagePct, setSlippagePct] = useState(0.5);
	const [quoteDetails, setQuoteDetails] = useState<QuoteDetails | null>(null);
	const [status, setStatus] = useState("");
	const [fromBalance, setFromBalance] = useState("");
	const [toBalance, setToBalance] = useState("");

	const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;

	const handleSwitchChain = () => {
		switchChain?.({ chainId: confluxLocalESpace.id });
	};

	const handleFromTokenChange = (nextIndex: number) => {
		setFromIdx(nextIndex);
		if (nextIndex === toIdx) {
			setToIdx(fromIdx);
		}
	};

	const handleToTokenChange = (nextIndex: number) => {
		setToIdx(nextIndex);
		if (nextIndex === fromIdx) {
			setFromIdx(toIdx);
		}
	};

	const ready = !!dex.router && dex.tokens.length >= 2;
	const fromToken = ready ? dex.tokens[fromIdx] : null;
	const toToken = ready
		? dex.tokens[toIdx >= dex.tokens.length ? 0 : toIdx]
		: null;
	const amountOutPreview =
		quoteDetails && toToken
			? Number(
					formatUnits(quoteDetails.amountOut, toToken.decimals),
				).toLocaleString(undefined, { maximumFractionDigits: 6 })
			: "0.0";

	useEffect(() => {
		if (!publicClient || !address || !fromToken || !toToken) {
			setFromBalance("");
			setToBalance("");
			return;
		}

		let cancelled = false;

		const loadBalances = async () => {
			try {
				const [nextFromBalance, nextToBalance] = await Promise.all([
					fromToken.isNative
						? publicClient.getBalance({ address })
						: publicClient.readContract({
								address: fromToken.address,
								abi: erc20Abi,
								functionName: "balanceOf",
								args: [address],
							}),
					toToken.isNative
						? publicClient.getBalance({ address })
						: publicClient.readContract({
								address: toToken.address,
								abi: erc20Abi,
								functionName: "balanceOf",
								args: [address],
							}),
				]);

				if (cancelled) return;
				setFromBalance(
					(Number(nextFromBalance) / 10 ** fromToken.decimals).toFixed(4),
				);
				setToBalance(
					(Number(nextToBalance) / 10 ** toToken.decimals).toFixed(4),
				);
			} catch {
				if (cancelled) return;
				setFromBalance("—");
				setToBalance("—");
			}
		};

		void loadBalances();
		return () => {
			cancelled = true;
		};
	}, [publicClient, address, fromToken, toToken]);

	useEffect(() => {
		if (
			!ready ||
			!amount ||
			!publicClient ||
			!dex.router ||
			!fromToken ||
			!toToken
		) {
			setQuoteDetails(null);
			return;
		}

		const router = dex.router;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const amountIn = parseUnits(amount, fromToken.decimals);
				const path = await buildPath(
					fromToken.address,
					toToken.address,
					publicClient,
					dex,
				);
				const amounts = (await publicClient.readContract({
					address: router,
					abi: ROUTER_ABI,
					functionName: "getAmountsOut",
					args: [amountIn, path],
				})) as bigint[];
				if (controller.signal.aborted) return;

				const exactRoute = simulateRouteExact(dex, path, amountIn);
				const amountOut = amounts[amounts.length - 1];
				const outFormatted = Number(formatUnits(amountOut, toToken.decimals));
				const minimumReceived = outFormatted * (1 - slippagePct / 100);

				setQuoteDetails({
					amountOut,
					route: path,
					routeSymbols:
						exactRoute?.routeSymbols ??
						path.map(
							(tokenAddress) =>
								dex.tokens.find(
									(token) =>
										token.address.toLowerCase() === tokenAddress.toLowerCase(),
								)?.symbol ?? "Token",
						),
					minimumReceived: Number.isFinite(minimumReceived)
						? `${minimumReceived.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${toToken.symbol}`
						: "—",
					executionPrice: exactRoute?.executionPrice ?? null,
					priceImpactPct: exactRoute?.priceImpactPct ?? null,
					feePct: 0.3 * (path.length - 1),
					hops: exactRoute?.hops ?? [],
				});
				setStatus("");
			} catch (err) {
				if (!controller.signal.aborted) {
					setQuoteDetails(null);
					setStatus(
						`Quote error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
					);
				}
			}
		}, 300);

		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [amount, dex, fromToken, publicClient, ready, slippagePct, toToken]);

	if (!ready || !fromToken || !toToken) {
		return (
			<Card className="rounded-[1.5rem] border-white/5 bg-bg-secondary/40 p-6 backdrop-blur-xl">
				<h2 className="text-xl font-black text-white uppercase tracking-tighter mb-2">
					Swap Engine
				</h2>
				<p className="text-text-secondary text-[11px] font-medium opacity-60 italic">
					Protocol synchronization pending. Ensure target contracts are
					deployed.
				</p>
			</Card>
		);
	}

	const handleSwap = async () => {
		if (!walletClient) {
			setStatus("Switch to Conflux eSpace Local (chain 2030)");
			return;
		}
		if (!publicClient || !address || !dex.router) {
			setStatus("Wallet Not Connected");
			return;
		}
		if (!amount) {
			setStatus("Amount Required");
			return;
		}

		const router = dex.router;
		setStatus("Preparing swap…");

		try {
			const amountIn = parseUnits(amount, fromToken.decimals);
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
			const path = await buildPath(
				fromToken.address,
				toToken.address,
				publicClient,
				dex,
			);
			const amountOutMin = quoteDetails
				? minOutWithSlippage(quoteDetails.amountOut, slippagePct)
				: 0n;

			if (fromToken.isNative) {
				const hash = await walletClient.writeContract({
					address: router,
					abi: ROUTER_ABI,
					functionName: "swapExactETHForTokens",
					args: [amountOutMin, path, address, deadline],
					value: amountIn,
				});
				setStatus("Swapping…");
				await publicClient.waitForTransactionReceipt({ hash });
			} else {
				setStatus("Approving…");
				const approveTx = await walletClient.writeContract({
					address: fromToken.address,
					abi: erc20Abi,
					functionName: "approve",
					args: [router, amountIn],
				});
				await publicClient.waitForTransactionReceipt({ hash: approveTx });

				if (toToken.isNative) {
					const hash = await walletClient.writeContract({
						address: router,
						abi: ROUTER_ABI,
						functionName: "swapExactTokensForETH",
						args: [amountIn, amountOutMin, path, address, deadline],
					});
					setStatus("Swapping…");
					await publicClient.waitForTransactionReceipt({ hash });
				} else {
					const hash = await walletClient.writeContract({
						address: router,
						abi: ROUTER_ABI,
						functionName: "swapExactTokensForTokens",
						args: [amountIn, amountOutMin, path, address, deadline],
					});
					setStatus("Swapping…");
					await publicClient.waitForTransactionReceipt({ hash });
				}
			}

			dex.refresh();
			setStatus("Swap success");
			setTimeout(() => setStatus(""), 8000);
		} catch (err) {
			setStatus(
				`Error: ${err instanceof Error ? err.message.slice(0, 100) : "unknown"}`,
			);
		}
	};

	const handleSwapDirection = () => {
		setFromIdx(toIdx);
		setToIdx(fromIdx);
		setAmount("");
		setQuoteDetails(null);
	};

	return (
		<div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-visible">
			<div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />

			<SectionHeader
				title="Swap"
				description="Multi-hop route aggregation."
				right={
					<div className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/5 p-1 shadow-inner">
						{[0.5, 1, 3].map((value) => (
							<button
								type="button"
								key={value}
								onClick={() => setSlippagePct(value)}
								className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] transition-all duration-300 ${slippagePct === value ? "bg-accent text-white shadow-lg" : "text-text-secondary/40 hover:text-white hover:bg-white/5"}`}
							>
								{value}%
							</button>
						))}
					</div>
				}
			/>

			<div className="relative flex flex-col gap-2">
				<TradeTokenField
					label="Payment Asset"
					sideLabel={fromBalance ? `Account: ${fromBalance}` : fromToken.symbol}
					amount={amount}
					onAmountChange={setAmount}
					tokens={dex.tokens}
					selectedIndex={fromIdx}
					onTokenChange={handleFromTokenChange}
				/>

				<div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
					<button
						type="button"
						onClick={handleSwapDirection}
						className="group flex h-10 w-10 items-center justify-center rounded-xl border-[4px] border-bg-secondary bg-bg-tertiary text-text-secondary shadow-xl transition-all duration-500 hover:scale-110 hover:border-accent/40 hover:text-accent active:scale-95"
						title="Invert Selection"
					>
						<span className="text-lg transition-all duration-700 group-hover:rotate-180">
							↕
						</span>
					</button>
				</div>

				<TradeTokenField
					label="Target Asset"
					sideLabel={toBalance ? `Account: ${toBalance}` : toToken.symbol}
					amount={amountOutPreview}
					tokens={dex.tokens}
					selectedIndex={toIdx}
					onTokenChange={handleToTokenChange}
					readonlyAmount
				/>
			</div>

			<div className="mt-6 flex flex-col gap-4">
				<TradeSummaryGrid
					items={[
						{
							label: "Network Route",
							value: quoteDetails
								? quoteDetails.routeSymbols.join(" → ")
								: "Syncing Path...",
						},
						{
							label: "Minimum Out",
							value: quoteDetails?.minimumReceived ?? "—",
						},
						{
							label: "Price Impact",
							value: formatPct(quoteDetails?.priceImpactPct ?? null),
						},
						{
							label: "Service Fee",
							value: quoteDetails ? `${quoteDetails.feePct.toFixed(2)}%` : "—",
							tone: "accent",
						},
					]}
				/>

				<TradeActionBar>
					<div className="flex flex-col gap-1.5 text-[9px] uppercase font-black tracking-[0.1em] text-text-secondary/65">
						<div className="flex items-center gap-2 italic">
							Slippage Limit:{" "}
							<span className="text-white not-italic">{slippagePct}%</span>
						</div>
						<div className="flex items-center gap-2 italic">
							Exchange Rate:{" "}
							<span className="text-white not-italic">
								{quoteDetails?.executionPrice != null
									? `${quoteDetails.executionPrice.toFixed(6)} ${toToken.symbol}/${fromToken.symbol}`
									: "—"}
							</span>
						</div>
					</div>
					<Button
						onClick={isWrongChain ? handleSwitchChain : handleSwap}
						disabled={
							!isConnected ||
							(!isWrongChain && (!amount || amountOutPreview === "—"))
						}
						variant={isWrongChain ? "secondary" : "primary"}
						className="h-12 min-w-[200px] text-[10px] font-black uppercase tracking-[0.25em] rounded-xl shadow-xl shadow-accent/10 transition-all hover:scale-[1.02] active:scale-[0.98]"
					>
						{isWrongChain
							? "Switch to eSpace"
							: !walletClient && isConnected
								? "Authorize Wallet"
								: "Execute Swap"}
					</Button>
				</TradeActionBar>
			</div>

			{status && (
				<StatusBanner
					message={status}
					tone={status.toLowerCase().includes("error") ? "error" : "accent"}
					className="mt-4 px-5 py-3"
				/>
			)}
		</div>
	);
}
