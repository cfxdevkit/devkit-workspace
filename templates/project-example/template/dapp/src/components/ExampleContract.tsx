import { StatusBanner, useAuth } from "@devkit/ui-shared";
import { base32AddressToHex, hexAddressToBase32 } from "cive/utils";
import { useEffect, useMemo, useState } from "react";
import {
	encodeFunctionData,
	getAddress,
	type Hex,
	keccak256,
	parseEther,
} from "viem";
import {
	useAccount,
	usePublicClient,
	useReadContract,
	useSendTransaction,
	useWaitForTransactionReceipt,
	useWriteContract,
} from "wagmi";
import { getChainLabel } from "../chains";
import { getContractAddress } from "../generated/contracts-addresses";
import {
	exampleCounterAbi,
	useReadExampleCounterValue,
} from "../generated/hooks";
import {
	getCoreChainConfigForEspaceChain,
	normalizeCoreAddressForChain,
	useCoreWallet,
} from "../hooks/useCoreWallet";
import { useDevkitNetworkSync } from "../hooks/useDevkitNetwork";

interface ContractEntry {
	name: string;
	address: string;
}

interface CoreExecutionResult {
	action: string;
	hash: Hex;
	outcomeStatus: "success" | "failed" | "skipped";
}

const EXAMPLE_CONTRACT_NAME = "ExampleCounter";
const CROSS_SPACE_CALL_ADDRESS =
	"0x0888000000000000000000000000000000000006" as const;
const CORE_BRIDGE_AMOUNT_CFX = "1";
const ESPACE_BRIDGE_AMOUNT_CFX = "1";
const CROSS_SPACE_CALL_ABI = [
	{
		type: "function",
		name: "callEVM",
		inputs: [
			{ name: "to", type: "bytes20", internalType: "bytes20" },
			{ name: "data", type: "bytes", internalType: "bytes" },
		],
		outputs: [{ name: "", type: "bytes", internalType: "bytes" }],
		stateMutability: "payable",
	},
	{
		type: "function",
		name: "transferEVM",
		inputs: [{ name: "to", type: "bytes20", internalType: "bytes20" }],
		outputs: [{ name: "", type: "bytes", internalType: "bytes" }],
		stateMutability: "payable",
	},
	{
		type: "function",
		name: "withdrawFromMapped",
		inputs: [{ name: "value", type: "uint256", internalType: "uint256" }],
		outputs: [],
		stateMutability: "nonpayable",
	},
	{
		type: "function",
		name: "mappedBalance",
		inputs: [{ name: "addr", type: "address", internalType: "address" }],
		outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
		stateMutability: "view",
	},
] as const;

function formatShortHash(hash: Hex | null) {
	if (!hash) {
		return "—";
	}

	return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function ExampleContract() {
	const { address: walletAddress, isConnected } = useAccount();
	const {
		isAuthenticated,
		isLoading: isAuthLoading,
		error: authError,
		signIn,
	} = useAuth();
	const { activeChainId, isWrongChain, switchToTargetChain, targetChainId } =
		useDevkitNetworkSync();
	const coreWallet = useCoreWallet();
	const targetCoreChain = getCoreChainConfigForEspaceChain(targetChainId);
	const normalizedCoreAddress = normalizeCoreAddressForChain(
		coreWallet.address,
		targetCoreChain.coreChainId,
	);
	const isCoreOnTarget =
		coreWallet.chainId?.toLowerCase() === targetCoreChain.chainIdHex;
	const crossSpaceCallCoreAddress = useMemo(
		() =>
			hexAddressToBase32({
				hexAddress: CROSS_SPACE_CALL_ADDRESS,
				networkId: targetCoreChain.coreChainId,
				verbose: false,
			}),
		[targetCoreChain.coreChainId],
	);

	const [contract, setContract] = useState<ContractEntry | null>(null);
	const [writeError, setWriteError] = useState("");
	const [status, setStatus] = useState("");
	const [lockAmount, setLockAmount] = useState("0.25");
	const [lockMinutes, setLockMinutes] = useState("5");
	const [isCoreActionPending, setIsCoreActionPending] = useState(false);
	const [lastCoreExecution, setLastCoreExecution] =
		useState<CoreExecutionResult | null>(null);
	const activeChainLabel = getChainLabel(activeChainId);
	const targetChainLabel = getChainLabel(targetChainId);
	const {
		writeContractAsync,
		data: txHash,
		isPending: isWriting,
	} = useWriteContract();
	const { isLoading: isConfirming, isSuccess: txConfirmed } =
		useWaitForTransactionReceipt({ hash: txHash });
	const { sendTransactionAsync, isPending: isSending } = useSendTransaction();
	const espacePublicClient = usePublicClient({ chainId: targetChainId });

	const { data: counterValue, refetch: refetchCounterValue } =
		useReadExampleCounterValue({
			address: contract?.address as `0x${string}` | undefined,
			chainId: targetChainId,
			query: {
				enabled: !!contract?.address,
				refetchInterval: 5_000,
			},
		});

	const { data: lockInfo, refetch: refetchLockInfo } = useReadContract({
		abi: exampleCounterAbi,
		address: contract?.address as `0x${string}` | undefined,
		chainId: targetChainId,
		functionName: "getLock",
		args: walletAddress ? [walletAddress] : undefined,
		query: {
			enabled: !!contract?.address && !!walletAddress,
			refetchInterval: 5_000,
		},
	});

	const activeLock = useMemo(() => {
		if (!lockInfo) return null;
		const [amount, unlockTimestamp, claimable] = lockInfo;
		return { amount, unlockTimestamp, claimable };
	}, [lockInfo]);

	useEffect(() => {
		const resolvedAddress = getContractAddress(
			targetChainId,
			EXAMPLE_CONTRACT_NAME,
		);
		if (!resolvedAddress) {
			setContract(null);
			return;
		}
		setContract({ name: EXAMPLE_CONTRACT_NAME, address: resolvedAddress });
	}, [targetChainId]);

	useEffect(() => {
		if (!txConfirmed) return;
		setStatus("✓ Finalized");
		const timer = setTimeout(() => setStatus(""), 5000);
		return () => clearTimeout(timer);
	}, [txConfirmed]);

	async function runWrite(
		action: () => Promise<unknown>,
		pendingLabel: string,
	) {
		try {
			setWriteError("");
			setStatus(pendingLabel);
			await action();
			setStatus("Mempool Entry...");
			return true;
		} catch (err) {
			const message = err instanceof Error ? err.message : "Write failure";
			setWriteError(message);
			setStatus("");
			return false;
		}
	}

	async function increment() {
		if (isWrongChain) {
			switchToTargetChain();
			return;
		}
		if (!contract) return;
		return runWrite(
			() =>
				writeContractAsync({
					abi: exampleCounterAbi,
					address: contract.address as `0x${string}`,
					chainId: targetChainId,
					functionName: "increment",
				}),
			"Incrementing...",
		);
	}

	async function reset() {
		if (isWrongChain) {
			switchToTargetChain();
			return;
		}
		if (!contract) return;
		return runWrite(
			() =>
				writeContractAsync({
					abi: exampleCounterAbi,
					address: contract.address as `0x${string}`,
					chainId: targetChainId,
					functionName: "reset",
				}),
			"Resetting...",
		);
	}

	async function lockFunds() {
		if (isWrongChain) {
			switchToTargetChain();
			return;
		}
		if (!contract) return;
		const minutes = Number(lockMinutes);
		if (!Number.isFinite(minutes) || minutes <= 0) {
			setWriteError("Duration required");
			return;
		}

		const unlockTimestamp = BigInt(
			Math.floor(Date.now() / 1000) + minutes * 60,
		);

		return runWrite(
			() =>
				writeContractAsync({
					abi: exampleCounterAbi,
					address: contract.address as `0x${string}`,
					chainId: targetChainId,
					functionName: "lock",
					args: [unlockTimestamp],
					value: parseEther(lockAmount || "0"),
				}),
			"Locking Assets...",
		);
	}

	async function withdrawLocked() {
		if (isWrongChain) {
			switchToTargetChain();
			return;
		}
		if (!contract) return;
		return runWrite(
			() =>
				writeContractAsync({
					abi: exampleCounterAbi,
					address: contract.address as `0x${string}`,
					chainId: targetChainId,
					functionName: "withdrawLocked",
				}),
			"Withdrawing...",
		);
	}

	async function getReadyCoreContext() {
		if (!contract) {
			setWriteError("Contract unavailable on the current eSpace target.");
			return null;
		}
		if (!coreWallet.isConnected || !normalizedCoreAddress) {
			setWriteError(
				"Connect the Core wallet before using cross-space actions.",
			);
			return null;
		}
		if (!isCoreOnTarget) {
			await coreWallet.switchChain(targetCoreChain);
			return null;
		}

		const walletClient = coreWallet.getWalletClient(targetCoreChain);
		if (!walletClient) {
			setWriteError("Core wallet client unavailable.");
			return null;
		}

		const publicClient = coreWallet.getPublicClient(targetCoreChain);
		return {
			account: normalizedCoreAddress,
			publicClient,
			walletClient,
		};
	}

	async function runCoreCrossSpaceAction(
		actionLabel: string,
		pendingLabel: string,
		successLabel: string,
		action: (
			context: NonNullable<Awaited<ReturnType<typeof getReadyCoreContext>>>,
		) => Promise<Hex>,
	) {
		const coreContext = await getReadyCoreContext();
		if (!coreContext) {
			return false;
		}

		setIsCoreActionPending(true);
		setWriteError("");
		setStatus(pendingLabel);

		try {
			const hash = await action(coreContext);
			setLastCoreExecution(null);
			setStatus("Waiting for Core finality...");

			const receipt = await coreContext.publicClient.waitForTransactionReceipt({
				hash,
				timeout: 90_000,
			});

			if (receipt.outcomeStatus !== "success") {
				throw new Error(`Core transaction ${receipt.outcomeStatus}.`);
			}

			setLastCoreExecution({
				action: actionLabel,
				hash,
				outcomeStatus: receipt.outcomeStatus,
			});
			setStatus(successLabel);
			await Promise.all([refetchCounterValue(), refetchLockInfo()]);
			return true;
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: "Core cross-space transaction failed";
			setWriteError(message);
			setStatus("");
			return false;
		} finally {
			setIsCoreActionPending(false);
		}
	}

	async function incrementFromCore() {
		if (!contract) return;

		const eSpaceCalldata = encodeFunctionData({
			abi: exampleCounterAbi,
			functionName: "increment",
		});

		return runCoreCrossSpaceAction(
			"Core increment",
			"Submitting Core -> eSpace increment...",
			"Core increment finalized.",
			({ account, walletClient }) =>
				walletClient.sendTransaction({
					account,
					to: crossSpaceCallCoreAddress,
					data: encodeFunctionData({
						abi: CROSS_SPACE_CALL_ABI,
						functionName: "callEVM",
						args: [contract.address as `0x${string}`, eSpaceCalldata],
					}),
				}),
		);
	}

	async function bridgeCfxFromCore() {
		if (!walletAddress) {
			setWriteError("Connect the eSpace wallet before bridging CFX from Core.");
			return;
		}

		return runCoreCrossSpaceAction(
			"Core bridge",
			`Bridging ${CORE_BRIDGE_AMOUNT_CFX} CFX to eSpace...`,
			`Bridged ${CORE_BRIDGE_AMOUNT_CFX} CFX to eSpace.`,
			({ account, walletClient }) =>
				walletClient.sendTransaction({
					account,
					to: crossSpaceCallCoreAddress,
					data: encodeFunctionData({
						abi: CROSS_SPACE_CALL_ABI,
						functionName: "transferEVM",
						args: [walletAddress],
					}),
					value: parseEther(CORE_BRIDGE_AMOUNT_CFX),
				}),
		);
	}

	/**
	 * Bridge CFX from eSpace → Core (two-step cross-space withdrawal).
	 *
	 * Step 1 (eSpace tx): send CFX to the Core wallet's MAPPED eSpace address.
	 *   The mapped address is keccak256(coreRawHex)[-20 bytes] — NOT the raw hex
	 *   of the Core address. Using the raw hex loses funds permanently.
	 *
	 * Step 2 (Core tx): call `CrossSpaceCall.withdrawFromMapped(value)`, which
	 *   moves the mapped balance into the Core wallet's native CFX balance.
	 *   Must wait for Core to credit the mapped balance first (cross-space
	 *   finality gap: the eSpace block must be referenced by a Core epoch).
	 */
	async function bridgeCfxFromESpace() {
		if (!normalizedCoreAddress) {
			setWriteError("Connect the Core wallet before bridging CFX to Core.");
			return;
		}
		if (!coreWallet.isConnected) {
			setWriteError("Connect the Core wallet before bridging CFX to Core.");
			return;
		}
		if (!isCoreOnTarget) {
			await coreWallet.switchChain(targetCoreChain);
			return;
		}

		// Derive the raw hex form of the Core address (used for mappedBalance query).
		let coreRawHex: `0x${string}`;
		try {
			coreRawHex = base32AddressToHex({
				address: normalizedCoreAddress,
			}) as `0x${string}`;
		} catch {
			setWriteError("Could not derive Core hex address.");
			return;
		}

		// Compute the mapped eSpace address: keccak256(coreRawHex)[-20 bytes].
		// This is the actual eSpace address that credits the Core wallet's mapped
		// balance. WARNING: do NOT use the raw hex directly — that address has no
		// connection to the mapped balance and sending funds there loses them.
		const mappedESpaceAddress = getAddress(
			`0x${keccak256(coreRawHex).slice(-40)}`,
		);

		const amount = parseEther(ESPACE_BRIDGE_AMOUNT_CFX);

		// Step 1: eSpace tx — send CFX to the Core wallet's mapped eSpace address.
		let espaceHash: `0x${string}` | undefined;
		try {
			setWriteError("");
			setStatus(
				`Step 1/2: Sending ${ESPACE_BRIDGE_AMOUNT_CFX} CFX to mapped account…`,
			);
			espaceHash = await sendTransactionAsync({
				to: mappedESpaceAddress,
				value: amount,
				chainId: targetChainId,
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "eSpace transfer failed";
			setWriteError(message);
			setStatus("");
			return;
		}

		// Wait for eSpace confirmation.
		try {
			setStatus("Step 1/2: Waiting for eSpace confirmation…");
			await espacePublicClient?.waitForTransactionReceipt({ hash: espaceHash });
		} catch {
			// Non-fatal: proceed to the mapped-balance poll.
		}

		// Poll mappedBalance on the Core side before calling withdrawFromMapped.
		// The eSpace block must first be referenced by a Core epoch — this can
		// take several seconds even on a local node (cross-space finality gap).
		setStatus("Step 1/2: Waiting for Core to credit mapped balance…");
		const coreContextForPoll = await getReadyCoreContext();
		if (!coreContextForPoll) return;

		const POLL_TIMEOUT_MS = 30_000;
		const POLL_INTERVAL_MS = 1_500;
		const deadline = Date.now() + POLL_TIMEOUT_MS;
		let credited = false;
		while (Date.now() < deadline) {
			const balance = await coreContextForPoll.publicClient.readContract({
				address: crossSpaceCallCoreAddress,
				abi: CROSS_SPACE_CALL_ABI,
				functionName: "mappedBalance",
				args: [normalizedCoreAddress],
			});
			if (balance >= amount) {
				credited = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		}

		if (!credited) {
			setWriteError(
				"Mapped balance was not credited within 30s. The eSpace tx may still be pending — try the withdrawal step again later.",
			);
			setStatus("");
			return;
		}

		// Step 2: Core tx — withdraw from mapped balance into Core wallet.
		return runCoreCrossSpaceAction(
			"eSpace bridge",
			`Step 2/2: Withdrawing ${ESPACE_BRIDGE_AMOUNT_CFX} CFX to Core wallet…`,
			`Bridged ${ESPACE_BRIDGE_AMOUNT_CFX} CFX to Core.`,
			({ account, walletClient }) =>
				walletClient.sendTransaction({
					account,
					to: crossSpaceCallCoreAddress,
					data: encodeFunctionData({
						abi: CROSS_SPACE_CALL_ABI,
						functionName: "withdrawFromMapped",
						args: [amount],
					}),
				}),
		);
	}

	const busy = isWriting || isConfirming || isSending || isCoreActionPending;

	return (
		<div className="flex flex-col gap-6">
			{/* Interaction Shell */}
			<div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-1">
				<div>
					<h2 className="text-xl font-black tracking-tighter text-white uppercase leading-none">
						Interactions
					</h2>
					<p className="mt-1 text-[11px] text-text-secondary/60 font-medium italic opacity-80">
						Execution hub for ExampleCounter protocol.
					</p>
				</div>
				<div
					className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] border backdrop-blur-md shadow-md ${contract ? "text-success/80 bg-success/5 border-success/10" : "text-text-secondary/40 bg-white/5 border-white/5"}`}
				>
					<span
						className={`h-1 w-1 rounded-full ${contract ? "bg-success animate-pulse" : "bg-text-secondary/20"}`}
					/>
					{contract ? "Contract Verified" : "Uninitialized"}
				</div>
			</div>

			{!contract && (
				<div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center animate-fade-in">
					<div className="max-w-md mx-auto">
						<h3 className="text-sm font-black text-white/60 mb-2 uppercase tracking-widest leading-none">
							Registry Miss
						</h3>
						<p className="text-text-secondary/30 text-[11px] leading-relaxed mb-6 font-bold uppercase italic tracking-tighter">
							Protocol object not detected on {targetChainLabel}. Sync required
							via CLI:
						</p>
						<div className="relative group grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
							<pre className="relative px-4 py-3 rounded-xl bg-black/40 border border-white/5 text-accent/80 font-black font-mono text-[10px] overflow-x-auto shadow-inner">
								{targetChainId === 71
									? "pnpm deploy:testnet"
									: targetChainId === 1030
										? "pnpm deploy:mainnet"
										: "pnpm deploy"}
							</pre>
						</div>
					</div>
				</div>
			)}

			{contract && (
				<div className="grid gap-6">
					{/* Metadata & State Grid */}
					<div className="grid gap-4 md:grid-cols-12">
						<div className="md:col-span-8 rounded-2xl border border-white/5 bg-bg-secondary/40 p-6 shadow-xl backdrop-blur-2xl transition-all duration-300">
							<div className="mb-4 flex items-center justify-between">
								<div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">
									Live State Engine
								</div>
								<span className="text-[8px] font-mono text-accent/30 tracking-tighter">
									{contract.address}
								</span>
							</div>
							<div className="grid gap-6 sm:grid-cols-2">
								<div className="flex flex-col justify-center">
									<div className="text-[9px] uppercase font-black tracking-widest text-text-secondary/40 italic leading-none mb-2">
										Counter Value
									</div>
									<div className="text-4xl font-black text-white tracking-tighter tabular-nums drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">
										{typeof counterValue === "bigint"
											? counterValue.toString()
											: "—"}
									</div>
								</div>
								<div className="flex flex-col gap-3 justify-center border-l border-white/5 pl-6">
									<div>
										<div className="text-[7px] uppercase font-black tracking-widest text-text-secondary/20 italic mb-0.5">
											Compiler
										</div>
										<div className="font-black text-[10px] text-text-primary/60 tracking-wider">
											Solidity 0.8.x
										</div>
									</div>
									<div>
										<div className="text-[7px] uppercase font-black tracking-widest text-text-secondary/20 italic mb-0.5">
											Architecture
										</div>
										<div className="font-black text-[10px] text-text-primary/60 tracking-wider">
											Stateful Engine
										</div>
									</div>
								</div>
							</div>
						</div>

						{activeLock && (
							<div className="md:col-span-4 rounded-2xl border border-accent/10 bg-accent/5 p-6 shadow-xl backdrop-blur-2xl animate-fade-in">
								<div className="mb-4 text-[8px] font-black uppercase tracking-[0.2em] text-accent/40 italic">
									Active Lock
								</div>
								<div className="space-y-4">
									<div className="text-center">
										<div className="text-[8px] uppercase font-black tracking-widest text-accent/30 italic mb-1">
											Vaulted
										</div>
										<div className="text-xl font-black text-white tracking-tight">
											{Number(activeLock.amount) / 1e18}{" "}
											<span className="text-[10px] text-accent/60">CFX</span>
										</div>
									</div>
									<div className="pt-3 border-t border-accent/10 grid grid-cols-2 gap-2 text-center">
										<div>
											<div className="text-[7px] uppercase font-black tracking-widest text-accent/30 mb-0.5">
												Expiry
											</div>
											<div className="font-mono text-[9px] font-black text-text-primary/60">
												{activeLock.unlockTimestamp > 0n
													? new Date(
															Number(activeLock.unlockTimestamp) * 1000,
														).toLocaleTimeString()
													: "—"}
											</div>
										</div>
										<div>
											<div className="text-[7px] uppercase font-black tracking-widest text-accent/30 mb-0.5">
												Status
											</div>
											<div
												className={`text-[8px] font-black uppercase tracking-widest ${activeLock.claimable ? "text-success animate-pulse" : "text-text-secondary/30"}`}
											>
												{activeLock.claimable ? "Ready" : "Locked"}
											</div>
										</div>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Actions Section */}
					{!isConnected ? (
						<div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01] p-10 text-center">
							<div className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em] italic">
								Authorization Required
							</div>
							<p className="mt-2 text-[10px] text-text-secondary/20 font-bold uppercase tracking-widest italic">
								Connect wallet to authorize protocol writes.
							</p>
						</div>
					) : isWrongChain ? (
						<div className="rounded-2xl border border-warning/10 bg-warning/5 p-8 flex flex-col items-center gap-4 text-center shadow-md">
							<p className="text-[11px] text-text-secondary/60 max-w-xs font-bold uppercase italic tracking-tighter leading-relaxed">
								Wallet network mismatch detected. Active on{" "}
								<span className="text-warning">{activeChainLabel}</span>.
								Target: <span className="text-accent">{targetChainLabel}</span>.
							</p>
							<button
								type="button"
								onClick={switchToTargetChain}
								className="btn btn-secondary !h-9 !px-6 !text-[10px] font-black uppercase tracking-[0.2em] shadow-lg"
							>
								Migrate Session
							</button>
						</div>
					) : !isAuthenticated ? (
						<div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 flex flex-col items-center gap-4 text-center shadow-md backdrop-blur-xl">
							<p className="text-text-secondary/40 text-[11px] max-w-xs font-bold uppercase italic tracking-tighter leading-relaxed">
								Secure session initialization required. Sign authorization to
								verify ownership.
							</p>
							<button
								type="button"
								onClick={() => void signIn()}
								disabled={isAuthLoading}
								className="btn btn-primary !h-10 !px-8 !text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-accent/20"
							>
								{isAuthLoading ? "Authorizing..." : "Initialize Session"}
							</button>
						</div>
					) : (
						<div className="grid gap-4 lg:grid-cols-3">
							<div className="flex flex-col gap-4 rounded-2xl border border-accent/10 bg-accent/5 p-6 backdrop-blur-md">
								<div>
									<div className="mb-1 text-[8px] font-black uppercase tracking-[0.2em] text-accent/50 italic">
										Core Cross-Space
									</div>
									<p className="text-[10px] leading-5 text-text-secondary/65">
										This path uses the native CrossSpaceCall precompile so
										Fluent can drive the eSpace counter or bridge CFX without a
										backend handoff.
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Core Signer
										</span>
										<span className="font-mono text-xs text-text-primary">
											{normalizedCoreAddress
												? `${normalizedCoreAddress.slice(0, 15)}…${normalizedCoreAddress.slice(-6)}`
												: "Not connected"}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Core Network
										</span>
										<span className="font-mono text-xs text-text-primary">
											{targetCoreChain.label}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Route
										</span>
										<span className="font-mono text-xs text-text-primary">
											Core → CrossSpaceCall → eSpace
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Bridge Target
										</span>
										<span className="font-mono text-xs text-text-primary">
											{walletAddress
												? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`
												: "Connect eSpace wallet"}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Last Core Tx
										</span>
										<span
											className={`font-mono text-xs ${lastCoreExecution?.outcomeStatus === "success" ? "text-success" : "text-text-primary"}`}
										>
											{formatShortHash(lastCoreExecution?.hash ?? null)}
										</span>
									</div>
								</div>
								<div className="mt-auto grid gap-2">
									<button
										type="button"
										onClick={() => void incrementFromCore()}
										disabled={
											busy || !coreWallet.isConnected || coreWallet.isSwitching
										}
										className="btn btn-secondary !h-10 !text-[9px] font-black uppercase tracking-[0.2em]"
									>
										{isCoreActionPending
											? "Awaiting Core Confirmation..."
											: "Increment From Core"}
									</button>
									<button
										type="button"
										onClick={() => void bridgeCfxFromCore()}
										disabled={
											busy ||
											!coreWallet.isConnected ||
											coreWallet.isSwitching ||
											!walletAddress
										}
										className="btn btn-primary !h-10 !text-[9px] font-black uppercase tracking-[0.2em]"
									>
										{isCoreActionPending
											? "Processing..."
											: `Bridge ${CORE_BRIDGE_AMOUNT_CFX} CFX To eSpace`}
									</button>
								</div>
							</div>

							{/* eSpace → Core Bridge */}
							<div className="flex flex-col gap-4 rounded-2xl border border-success/10 bg-success/5 p-6 backdrop-blur-md">
								<div>
									<div className="mb-1 text-[8px] font-black uppercase tracking-[0.2em] text-success/50 italic">
										eSpace → Core Bridge
									</div>
									<p className="text-[10px] leading-5 text-text-secondary/65">
										Two-step withdrawal: sends CFX to the Core wallet's mapped
										account in eSpace, then calls{" "}
										<span className="font-mono text-[9px]">
											withdrawFromMapped
										</span>{" "}
										from Core to claim it.
									</p>
								</div>
								<div className="space-y-2">
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Route
										</span>
										<span className="font-mono text-xs text-text-primary">
											eSpace → mapped account → Core
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 border-b border-white/5 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Bridge Target
										</span>
										<span className="font-mono text-xs text-text-primary">
											{normalizedCoreAddress
												? `${normalizedCoreAddress.slice(0, 15)}…${normalizedCoreAddress.slice(-6)}`
												: "Connect Core wallet"}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 py-2">
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/45">
											Last Core Tx
										</span>
										<span
											className={`font-mono text-xs ${lastCoreExecution?.action === "eSpace bridge" && lastCoreExecution.outcomeStatus === "success" ? "text-success" : "text-text-primary"}`}
										>
											{lastCoreExecution?.action === "eSpace bridge"
												? formatShortHash(lastCoreExecution.hash)
												: "—"}
										</span>
									</div>
								</div>
								<div className="mt-auto">
									<button
										type="button"
										onClick={() => void bridgeCfxFromESpace()}
										disabled={
											busy ||
											!coreWallet.isConnected ||
											coreWallet.isSwitching ||
											!walletAddress
										}
										className="btn btn-primary w-full !h-10 !text-[9px] font-black uppercase tracking-[0.2em]"
									>
										{isCoreActionPending || isSending
											? "Processing..."
											: `Bridge ${ESPACE_BRIDGE_AMOUNT_CFX} CFX To Core`}
									</button>
								</div>
							</div>

							{/* eSpace Methods + Timelock */}
							<div className="flex flex-col gap-4 rounded-2xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-md transition-all focus-within:border-accent/20 focus-within:bg-white/[0.04]">
								<div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">
									eSpace Methods
								</div>
								<div className="grid gap-3">
									<button
										type="button"
										onClick={increment}
										disabled={busy}
										className="btn btn-primary !h-12 !text-[11px] font-black uppercase tracking-[0.3em] rounded-xl shadow-xl transition-all"
									>
										{busy ? "Processing..." : "Inc State"}
									</button>
									<button
										type="button"
										onClick={reset}
										disabled={busy}
										className="btn btn-ghost !h-9 !text-[9px] font-black uppercase tracking-[0.2em] text-text-secondary/40 hover:text-white"
									>
										Reset Engine
									</button>
								</div>

								<div className="border-t border-white/5 pt-4">
									<div className="mb-3 text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">
										Timelock Parameters
									</div>
									<div className="grid gap-4 sm:grid-cols-2">
										<div className="flex flex-col gap-1.5">
											<label
												htmlFor="lock-amount"
												className="text-[8px] font-black uppercase tracking-[0.15em] text-text-secondary/40 pl-1 italic"
											>
												Amount
											</label>
											<input
												id="lock-amount"
												className="bg-transparent border border-white/5 rounded-lg h-9 px-3 font-mono text-[11px] font-black tracking-widest text-white outline-none focus:border-accent/30 focus:bg-white/5"
												value={lockAmount}
												onChange={(e) => setLockAmount(e.target.value)}
												inputMode="decimal"
												placeholder="0.25"
											/>
										</div>
										<div className="flex flex-col gap-1.5">
											<label
												htmlFor="lock-minutes"
												className="text-[8px] font-black uppercase tracking-[0.15em] text-text-secondary/40 pl-1 italic"
											>
												Min
											</label>
											<input
												id="lock-minutes"
												className="bg-transparent border border-white/5 rounded-lg h-9 px-3 font-mono text-[11px] font-black tracking-widest text-white outline-none focus:border-accent/30 focus:bg-white/5"
												value={lockMinutes}
												onChange={(e) => setLockMinutes(e.target.value)}
												inputMode="numeric"
												placeholder="5"
											/>
										</div>
									</div>
									<div className="mt-4 grid gap-2 sm:grid-cols-2">
										<button
											type="button"
											onClick={lockFunds}
											disabled={busy}
											className="btn btn-secondary !h-9 !text-[9px] font-black uppercase tracking-[0.2em]"
										>
											Lock
										</button>
										<button
											type="button"
											onClick={withdrawLocked}
											disabled={busy || !activeLock?.claimable}
											className="btn btn-danger !h-9 !text-[9px] font-black uppercase tracking-[0.2em]"
										>
											Claim
										</button>
									</div>
								</div>
							</div>
						</div>
					)}

					{/* Status Feedback */}
					{status ? (
						<StatusBanner
							message={status}
							tone={status.startsWith("✓") ? "success" : "accent"}
						/>
					) : null}
					{writeError ? (
						<StatusBanner
							message={`Error: ${writeError.slice(0, 100)}`}
							tone="error"
						/>
					) : null}
					{authError ? <StatusBanner message={authError} tone="error" /> : null}

					<div className="border-t border-white/5 pt-6 flex flex-col items-center gap-2 select-none opacity-20">
						<span className="text-[8px] font-black uppercase tracking-[0.3em] text-text-secondary">
							Wagmi Integrated Sandbox
						</span>
						<p className="text-text-secondary text-[7px] uppercase tracking-widest font-black leading-none italic">
							Type-safe hooks auto-generated from solidity
						</p>
					</div>
				</div>
			)}
		</div>
	);
}
