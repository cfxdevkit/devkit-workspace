// ── use-wallet-react: Core Space (Fluent) ────────────────────────────────────
// injectFlag = "conflux" → looks for window.conflux
// sessionKey  = "conflux-isFluent" → page-reload counter (max 2 reloads on -32602)
import {
	addChain as coreAddChain,
	connect as coreConnect,
	provider as coreProvider,
	switchChain as coreSwitchChain,
	useAccount as useCoreAccount,
	useChainId as useCoreChainId,
	useStatus as useCoreStatus,
} from "@cfxjs/use-wallet-react/conflux/Fluent";
// ── use-wallet-react: eSpace Fluent ─────────────────────────────────────────
// injectFlag = "fluent" → looks for window.fluent  (separate from window.ethereum!)
// sessionKey  = "fluent-isFluent"
import {
	connect as efluentConnect,
	provider as efluentProvider,
	useAccount as useEfluentAccount,
	useChainId as useEfluentChainId,
	useStatus as useEfluentStatus,
} from "@cfxjs/use-wallet-react/ethereum/Fluent";
// ── use-wallet-react: eSpace MetaMask ───────────────────────────────────────
// injectFlag = "ethereum" → looks for window.ethereum with isMetaMask flag
import {
	connect as metamaskConnect,
	provider as metamaskProvider,
	useAccount as useMetaMaskAccount,
	useChainId as useMetaMaskChainId,
	useStatus as useMetaMaskStatus,
} from "@cfxjs/use-wallet-react/ethereum/MetaMask";
import { useCallback, useEffect, useRef, useState } from "react";

// ── wagmi: injected (MetaMask / any EIP-1193) ───────────────────────────────
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type LogEntry = {
	id: number;
	ts: string;
	msg: string;
	level?: "error" | "warn" | "info";
};

let _logId = 0;
function makeEntry(msg: string, level?: LogEntry["level"]): LogEntry {
	return {
		id: ++_logId,
		ts: new Date().toISOString().slice(11, 23),
		msg,
		level,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive UI components
// ─────────────────────────────────────────────────────────────────────────────

function Badge({ value, tag }: { value: string; tag?: string }) {
	const cls = [
		"badge",
		value === "active" || value === "true" || value === "connected"
			? "badge-ok"
			: "",
		value === "not-installed" || value === "false" || value === "null"
			? "badge-off"
			: "",
		value === "in-detecting" || value === "in-activating"
			? "badge-pending"
			: "",
		value === "not-active" ? "badge-idle" : "",
	]
		.filter(Boolean)
		.join(" ");
	return (
		<span className={cls}>
			{tag ? <em>{tag}:</em> : null}
			{value}
		</span>
	);
}

function Row({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="kv">
			<span className="kv-label">{label}</span>
			<span className={mono ? "kv-val mono" : "kv-val"}>{value}</span>
		</div>
	);
}

function LogBox({ entries }: { entries: LogEntry[] }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (ref.current) ref.current.scrollTop = 0;
	}, []);
	if (entries.length === 0)
		return <div className="logbox empty">— no events yet —</div>;
	return (
		<div className="logbox" ref={ref}>
			{entries.map((e) => (
				<div
					key={e.id}
					className={`log-line${e.level ? ` log-${e.level}` : ""}`}
				>
					<span className="log-ts">{e.ts}</span>
					<span className="log-msg">{e.msg}</span>
				</div>
			))}
		</div>
	);
}

function Panel({
	title,
	accent,
	children,
}: {
	title: string;
	accent: string;
	children: React.ReactNode;
}) {
	return (
		<section
			className="panel"
			style={{ "--accent": accent } as React.CSSProperties}
		>
			<h2 className="panel-title">{title}</h2>
			{children}
		</section>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Raw window detection
// ─────────────────────────────────────────────────────────────────────────────
function RawWindowPanel({
	addGlobalLog,
}: {
	addGlobalLog: (e: LogEntry) => void;
}) {
	type WindowInfo = {
		ethereum_present: boolean;
		ethereum_isMetaMask: boolean | undefined;
		ethereum_isFluent: boolean | undefined;
		ethereum_providers_count: number | undefined;
		fluent_present: boolean;
		fluent_isFluent: boolean | undefined;
		conflux_present: boolean;
		conflux_isFluent: boolean | undefined;
		core_reload_counter: string;
		espace_fluent_reload_counter: string;
	};

	const [info, setInfo] = useState<WindowInfo | null>(null);

	useEffect(() => {
		const collect = () => {
			const w = window as unknown as Record<string, unknown>;
			const eth = w.ethereum as Record<string, unknown> | undefined;
			const fluent = w.fluent as Record<string, unknown> | undefined;
			const cfx = w.conflux as Record<string, unknown> | undefined;
			const providers = eth?.providers as unknown[] | undefined;

			const next: WindowInfo = {
				ethereum_present: !!eth,
				ethereum_isMetaMask: eth?.isMetaMask as boolean | undefined,
				ethereum_isFluent: eth?.isFluent as boolean | undefined,
				ethereum_providers_count: providers?.length,
				fluent_present: !!fluent,
				fluent_isFluent: fluent?.isFluent as boolean | undefined,
				conflux_present: !!cfx,
				conflux_isFluent: cfx?.isFluent as boolean | undefined,
				core_reload_counter:
					sessionStorage.getItem("conflux-isFluent") ?? "(not set)",
				espace_fluent_reload_counter:
					sessionStorage.getItem("fluent-isFluent") ?? "(not set)",
			};
			setInfo((prev) => {
				if (JSON.stringify(prev) !== JSON.stringify(next)) {
					addGlobalLog(
						makeEntry(
							`window scan updated: conflux=${next.conflux_present} fluent=${next.fluent_present} eth=${next.ethereum_present}`,
							"info",
						),
					);
				}
				return next;
			});
		};
		collect();
		const t = window.setInterval(collect, 800);
		return () => window.clearInterval(t);
	}, [addGlobalLog]);

	return (
		<Panel title="🔍 Raw window scan" accent="#4a9eff">
			<p className="panel-hint">
				Polled every 800 ms. Shows what providers are actually on{" "}
				<code>window</code>.
			</p>
			{info ? (
				<>
					<div className="group-label">window.ethereum</div>
					<Row label="present" value={String(info.ethereum_present)} />
					<Row label="isMetaMask" value={String(info.ethereum_isMetaMask)} />
					<Row label="isFluent" value={String(info.ethereum_isFluent)} />
					<Row
						label="providers[]"
						value={
							info.ethereum_providers_count != null
								? `${String(info.ethereum_providers_count)} entries`
								: "none"
						}
					/>

					<div className="group-label">window.fluent</div>
					<Row label="present" value={String(info.fluent_present)} />
					<Row label="isFluent" value={String(info.fluent_isFluent)} />

					<div className="group-label">window.conflux</div>
					<Row label="present" value={String(info.conflux_present)} />
					<Row label="isFluent" value={String(info.conflux_isFluent)} />

					<div className="group-label">
						sessionStorage counters (page-reload on -32602)
					</div>
					<Row label="conflux-isFluent" value={info.core_reload_counter} />
					<Row
						label="fluent-isFluent"
						value={info.espace_fluent_reload_counter}
					/>

					<button
						type="button"
						className="btn btn-sm"
						onClick={async () => {
							const w = window as unknown as Record<string, unknown>;
							const cfx = w.conflux as
								| { request: (a: { method: string }) => Promise<unknown> }
								| undefined;
							if (!cfx) {
								addGlobalLog(makeEntry("window.conflux not found", "error"));
								return;
							}
							addGlobalLog(
								makeEntry(
									"Direct: cfx_requestAccounts via window.conflux…",
									"info",
								),
							);
							try {
								const res = await cfx.request({
									method: "cfx_requestAccounts",
								});
								addGlobalLog(
									makeEntry(
										`Direct: cfx_requestAccounts ✓ → ${JSON.stringify(res)}`,
										"info",
									),
								);
							} catch (e: unknown) {
								addGlobalLog(
									makeEntry(
										`Direct: cfx_requestAccounts error: ${(e as Error)?.message ?? String(e)}`,
										"error",
									),
								);
							}
						}}
					>
						Direct: cfx_requestAccounts
					</button>
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => {
							sessionStorage.removeItem("conflux-isFluent");
							sessionStorage.removeItem("fluent-isFluent");
							addGlobalLog(
								makeEntry(
									"sessionStorage counters cleared — reloading…",
									"warn",
								),
							);
							setTimeout(() => window.location.reload(), 300);
						}}
					>
						Clear counters + reload
					</button>
				</>
			) : (
				<span className="muted">scanning…</span>
			)}
		</Panel>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Core Space — @cfxjs/use-wallet-react/conflux/Fluent
//    detects window.conflux with isFluent=true
// ─────────────────────────────────────────────────────────────────────────────
function CoreFluentPanel({
	addGlobalLog,
}: {
	addGlobalLog: (e: LogEntry) => void;
}) {
	const status = useCoreStatus();
	const account = useCoreAccount();
	const chainId = useCoreChainId();
	const [localLog, setLocalLog] = useState<LogEntry[]>([]);
	const [error, setError] = useState<string | null>(null);

	const log = useCallback(
		(msg: string, level?: LogEntry["level"]) => {
			const e = makeEntry(msg, level);
			setLocalLog((p) => [e, ...p.slice(0, 29)]);
			addGlobalLog({ ...e, msg: `[Core/Fluent] ${msg}` });
		},
		[addGlobalLog],
	);

	useEffect(() => {
		log(`status → ${status ?? "undefined"}`);
	}, [status, log]); // eslint-disable-line
	useEffect(() => {
		if (account !== undefined) log(`account → ${account ?? "null"}`);
	}, [account, log]); // eslint-disable-line
	useEffect(() => {
		if (chainId !== undefined) log(`chainId → ${chainId ?? "null"}`);
	}, [chainId, log]); // eslint-disable-line

	const handleConnect = async () => {
		if (status !== "not-active") {
			log(`connect() skipped — status=${status}`, "warn");
			return;
		}
		setError(null);
		log("connect() called (status=not-active)");
		try {
			await coreConnect();
			log("connect() resolved ✓", "info");
		} catch (e: unknown) {
			const msg = (e as Error)?.message ?? String(e);
			log(`connect() error: ${msg}`, "error");
			setError(msg);
		}
	};

	const handleAddTestnet = async () => {
		log("addChain(testnet, needConnected=false) called");
		try {
			await coreAddChain(
				{
					chainId: "0x1",
					chainName: "Conflux Core Testnet",
					nativeCurrency: { name: "Conflux", symbol: "CFX", decimals: 18 },
					rpcUrls: ["https://test.confluxrpc.com"],
					blockExplorerUrls: ["https://testnet.confluxscan.org"],
				},
				false,
			);
			log("addChain(testnet) resolved ✓", "info");
		} catch (e: unknown) {
			log(`addChain error: ${(e as Error)?.message ?? String(e)}`, "error");
		}
	};

	const handleSwitchTestnet = async () => {
		log("switchChain(0x1) called");
		try {
			await coreSwitchChain("0x1");
			log("switchChain resolved ✓", "info");
		} catch (e: unknown) {
			log(`switchChain error: ${(e as Error)?.message ?? String(e)}`, "error");
		}
	};

	const isLoading = status === "in-detecting" || status === "in-activating";

	return (
		<Panel title="⬡ Core Space — Fluent" accent="#e8820c">
			<p className="panel-hint">
				<code>@cfxjs/use-wallet-react/conflux/Fluent</code>
				<br />
				Detects <code>window.conflux</code> with <code>isFluent=true</code>.
			</p>
			<div className="status-row">
				<Badge value={status ?? "undefined"} tag="status" />
				<Badge value={coreProvider ? "present" : "null"} tag="provider" />
			</div>
			<Row label="account" value={account ?? "null"} mono />
			<Row label="chainId" value={chainId ?? "null"} mono />
			{error && <div className="error-box">{error}</div>}
			<div className="btn-row">
				<button
					type="button"
					className="btn"
					onClick={handleConnect}
					disabled={
						isLoading || status === "active" || status === "not-installed"
					}
				>
					{status === "in-detecting"
						? "Detecting…"
						: status === "in-activating"
							? "Connecting…"
							: status === "active"
								? "✓ Connected"
								: status === "not-installed"
									? "Not Installed"
									: "Connect Core"}
				</button>
				<button
					type="button"
					className="btn btn-sm"
					onClick={handleAddTestnet}
					disabled={!coreProvider}
				>
					Add Testnet
				</button>
				<button
					type="button"
					className="btn btn-sm"
					onClick={handleSwitchTestnet}
					disabled={!coreProvider}
				>
					Switch Testnet
				</button>
			</div>
			<LogBox entries={localLog} />
		</Panel>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. eSpace Fluent — @cfxjs/use-wallet-react/ethereum/Fluent
//    detects window.fluent (NOT window.ethereum!)
// ─────────────────────────────────────────────────────────────────────────────
function EspaceFluentPanel({
	addGlobalLog,
}: {
	addGlobalLog: (e: LogEntry) => void;
}) {
	const status = useEfluentStatus();
	const account = useEfluentAccount();
	const chainId = useEfluentChainId();
	const [localLog, setLocalLog] = useState<LogEntry[]>([]);
	const [error, setError] = useState<string | null>(null);

	const log = useCallback(
		(msg: string, level?: LogEntry["level"]) => {
			const e = makeEntry(msg, level);
			setLocalLog((p) => [e, ...p.slice(0, 29)]);
			addGlobalLog({ ...e, msg: `[eSpace/Fluent] ${msg}` });
		},
		[addGlobalLog],
	);

	useEffect(() => {
		log(`status → ${status ?? "undefined"}`);
	}, [status, log]); // eslint-disable-line
	useEffect(() => {
		if (account !== undefined) log(`account → ${account ?? "null"}`);
	}, [account, log]); // eslint-disable-line
	useEffect(() => {
		if (chainId !== undefined) log(`chainId → ${chainId ?? "null"}`);
	}, [chainId, log]); // eslint-disable-line

	const handleConnect = async () => {
		if (status !== "not-active") {
			log(`connect() skipped — status=${status}`, "warn");
			return;
		}
		setError(null);
		log("connect() called");
		try {
			await efluentConnect();
			log("connect() resolved ✓", "info");
		} catch (e: unknown) {
			const msg = (e as Error)?.message ?? String(e);
			log(`connect() error: ${msg}`, "error");
			setError(msg);
		}
	};

	const isLoading = status === "in-detecting" || status === "in-activating";

	return (
		<Panel title="◎ eSpace — Fluent (ethereum/Fluent)" accent="#7c4dff">
			<p className="panel-hint">
				<code>@cfxjs/use-wallet-react/ethereum/Fluent</code>
				<br />
				Detects <code>window.fluent</code> (isFluent=true) —{" "}
				<strong>NOT</strong> <code>window.ethereum</code>.<br />
				If Fluent doesn't inject <code>window.fluent</code>, status will be{" "}
				<code>not-installed</code>.
			</p>
			<div className="status-row">
				<Badge value={status ?? "undefined"} tag="status" />
				<Badge value={efluentProvider ? "present" : "null"} tag="provider" />
			</div>
			<Row label="account" value={account ?? "null"} mono />
			<Row label="chainId" value={chainId ?? "null"} mono />
			{error && <div className="error-box">{error}</div>}
			<div className="btn-row">
				<button
					type="button"
					className="btn"
					onClick={handleConnect}
					disabled={
						isLoading || status === "active" || status === "not-installed"
					}
				>
					{status === "in-detecting"
						? "Detecting…"
						: status === "in-activating"
							? "Connecting…"
							: status === "active"
								? "✓ Connected"
								: status === "not-installed"
									? "✗ window.fluent missing"
									: "Connect eSpace-Fluent"}
				</button>
			</div>
			<LogBox entries={localLog} />
		</Panel>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. eSpace MetaMask — @cfxjs/use-wallet-react/ethereum/MetaMask
//    detects window.ethereum with isMetaMask=true
// ─────────────────────────────────────────────────────────────────────────────
function EspaceMetaMaskLibPanel({
	addGlobalLog,
}: {
	addGlobalLog: (e: LogEntry) => void;
}) {
	const status = useMetaMaskStatus();
	const account = useMetaMaskAccount();
	const chainId = useMetaMaskChainId();
	const [localLog, setLocalLog] = useState<LogEntry[]>([]);
	const [error, setError] = useState<string | null>(null);

	const log = useCallback(
		(msg: string, level?: LogEntry["level"]) => {
			const e = makeEntry(msg, level);
			setLocalLog((p) => [e, ...p.slice(0, 29)]);
			addGlobalLog({ ...e, msg: `[eSpace/MetaMask-lib] ${msg}` });
		},
		[addGlobalLog],
	);

	useEffect(() => {
		log(`status → ${status ?? "undefined"}`);
	}, [status, log]); // eslint-disable-line
	useEffect(() => {
		if (account !== undefined) log(`account → ${account ?? "null"}`);
	}, [account, log]); // eslint-disable-line

	const handleConnect = async () => {
		if (status !== "not-active") {
			log(`connect() skipped — status=${status}`, "warn");
			return;
		}
		setError(null);
		log("connect() called");
		try {
			await metamaskConnect();
			log("connect() resolved ✓", "info");
		} catch (e: unknown) {
			const msg = (e as Error)?.message ?? String(e);
			log(`connect() error: ${msg}`, "error");
			setError(msg);
		}
	};

	const isLoading = status === "in-detecting" || status === "in-activating";

	return (
		<Panel title="🦊 eSpace — MetaMask (ethereum/MetaMask)" accent="#f6851b">
			<p className="panel-hint">
				<code>@cfxjs/use-wallet-react/ethereum/MetaMask</code>
				<br />
				Detects <code>window.ethereum</code> with <code>isMetaMask=true</code>.
				<br />
				Fluent eSpace also sets <code>isMetaMask=true</code> — so this works for
				both.
			</p>
			<div className="status-row">
				<Badge value={status ?? "undefined"} tag="status" />
				<Badge value={metamaskProvider ? "present" : "null"} tag="provider" />
			</div>
			<Row label="account" value={account ?? "null"} mono />
			<Row label="chainId" value={chainId ?? "null"} mono />
			{error && <div className="error-box">{error}</div>}
			<div className="btn-row">
				<button
					type="button"
					className="btn"
					onClick={handleConnect}
					disabled={
						isLoading || status === "active" || status === "not-installed"
					}
				>
					{status === "in-detecting"
						? "Detecting…"
						: status === "in-activating"
							? "Connecting…"
							: status === "active"
								? "✓ Connected"
								: status === "not-installed"
									? "✗ No MetaMask"
									: "Connect MetaMask"}
				</button>
			</div>
			<LogBox entries={localLog} />
		</Panel>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. eSpace — wagmi injected (standard EIP-6963/EIP-1193)
// ─────────────────────────────────────────────────────────────────────────────
function WagmiPanel({ addGlobalLog }: { addGlobalLog: (e: LogEntry) => void }) {
	const {
		address,
		isConnected,
		isConnecting,
		isReconnecting,
		chainId: accountChainId,
		status,
	} = useAccount();
	const chainId = useChainId();
	const { connect, isPending, error: connectError } = useConnect();
	const { disconnect } = useDisconnect();
	const [localLog, setLocalLog] = useState<LogEntry[]>([]);

	const log = useCallback(
		(msg: string, level?: LogEntry["level"]) => {
			const e = makeEntry(msg, level);
			setLocalLog((p) => [e, ...p.slice(0, 29)]);
			addGlobalLog({ ...e, msg: `[wagmi] ${msg}` });
		},
		[addGlobalLog],
	);

	useEffect(() => {
		log(`status → ${status}`);
	}, [status, log]); // eslint-disable-line
	useEffect(() => {
		log(`account chainId → ${accountChainId ?? "null"}`);
	}, [accountChainId, log]); // eslint-disable-line
	useEffect(() => {
		if (connectError) log(`connectError: ${connectError.message}`, "error");
	}, [connectError, log]); // eslint-disable-line

	return (
		<Panel title="🔗 eSpace — wagmi injected" accent="#10a37f">
			<p className="panel-hint">
				Standard wagmi + <code>injected()</code> connector.
				<br />
				Uses <code>window.ethereum</code> via EIP-1193. Works with MetaMask,
				Fluent eSpace, and any injected wallet.
			</p>
			<div className="status-row">
				<Badge value={status} tag="status" />
				{isConnecting && <Badge value="connecting" />}
				{isReconnecting && <Badge value="reconnecting" />}
			</div>
			<Row label="isConnected" value={String(isConnected)} />
			<Row label="address" value={address ?? "null"} mono />
			<Row
				label="account chainId"
				value={String(accountChainId ?? "null")}
				mono
			/>
			<Row label="config chainId" value={String(chainId)} mono />
			{connectError && <div className="error-box">{connectError.message}</div>}
			<div className="btn-row">
				{isConnected ? (
					<button
						type="button"
						className="btn"
						onClick={() => {
							log("disconnect() called");
							disconnect();
						}}
					>
						Disconnect
					</button>
				) : (
					<button
						type="button"
						className="btn"
						disabled={isPending}
						onClick={() => {
							log("connect(injected) called");
							connect({ connector: injected() });
						}}
					>
						{isPending ? "Connecting…" : "Connect injected"}
					</button>
				)}
			</div>
			<LogBox entries={localLog} />
		</Panel>
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Global provider event listener
// ─────────────────────────────────────────────────────────────────────────────
function useGlobalProviderEvents(addGlobalLog: (e: LogEntry) => void) {
	useEffect(() => {
		const w = window as unknown as Record<string, unknown>;

		function attachProviderListeners(name: string, provider: unknown) {
			if (
				!provider ||
				typeof (provider as Record<string, unknown>).on !== "function"
			)
				return;
			const p = provider as {
				on: (event: string, handler: (data: unknown) => void) => void;
				removeListener: (
					event: string,
					handler: (data: unknown) => void,
				) => void;
			};

			const make = (event: string) => (data: unknown) => {
				addGlobalLog(
					makeEntry(`[${name}] ${event}: ${JSON.stringify(data)}`, "info"),
				);
			};

			const handlers: Record<string, (data: unknown) => void> = {
				accountsChanged: make("accountsChanged"),
				chainChanged: make("chainChanged"),
				connect: make("connect"),
				disconnect: make("disconnect"),
				message: make("message"),
			};

			for (const [ev, h] of Object.entries(handlers)) p.on(ev, h);
			return () => {
				for (const [ev, h] of Object.entries(handlers)) p.removeListener(ev, h);
			};
		}

		const cleanups: Array<(() => void) | undefined> = [];

		// Try attaching now, and poll until providers appear
		const tryAttach = () => {
			const eth = w.ethereum;
			const cfx = w.conflux;
			const fluent = w.fluent;

			if (eth && !(eth as Record<string, boolean>).__probe_listening) {
				(eth as Record<string, boolean>).__probe_listening = true;
				cleanups.push(attachProviderListeners("window.ethereum", eth));
			}
			if (cfx && !(cfx as Record<string, boolean>).__probe_listening) {
				(cfx as Record<string, boolean>).__probe_listening = true;
				cleanups.push(attachProviderListeners("window.conflux", cfx));
			}
			if (fluent && !(fluent as Record<string, boolean>).__probe_listening) {
				(fluent as Record<string, boolean>).__probe_listening = true;
				cleanups.push(attachProviderListeners("window.fluent", fluent));
			}
		};

		tryAttach();
		const t = window.setInterval(tryAttach, 500);

		return () => {
			window.clearInterval(t);
			cleanups.forEach((c) => {
				c?.();
			});
		};
	}, [addGlobalLog]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────────────────────
export function App() {
	const [globalLog, setGlobalLog] = useState<LogEntry[]>([]);

	const addGlobalLog = useCallback((e: LogEntry) => {
		setGlobalLog((p) => [e, ...p.slice(0, 99)]);
	}, []);

	useGlobalProviderEvents(addGlobalLog);

	return (
		<div className="shell">
			<header className="page-header">
				<h1>🔍 Wallet Probe</h1>
				<p>
					Diagnostic page that exercises every wallet connection surface
					simultaneously.
					<br />
					Open browser DevTools alongside to correlate console output with the
					state changes here.
				</p>
				<p style={{ marginTop: 8, fontSize: "0.85rem" }}>
					<a
						href="/fluent-reference.html"
						target="_blank"
						rel="noopener noreferrer"
						style={{ color: "#4a9eff" }}
					>
						📄 Open reference implementation (vanilla JS) →
					</a>
				</p>
			</header>

			<div className="grid">
				<RawWindowPanel addGlobalLog={addGlobalLog} />
				<CoreFluentPanel addGlobalLog={addGlobalLog} />
				<EspaceFluentPanel addGlobalLog={addGlobalLog} />
				<EspaceMetaMaskLibPanel addGlobalLog={addGlobalLog} />
				<WagmiPanel addGlobalLog={addGlobalLog} />

				<Panel title="📋 Global event log" accent="#888">
					<p className="panel-hint">
						All state changes and provider events across every panel, newest
						first.
					</p>
					<button
						type="button"
						className="btn btn-sm"
						onClick={() => setGlobalLog([])}
					>
						Clear
					</button>
					<LogBox entries={globalLog} />
				</Panel>
			</div>
		</div>
	);
}
