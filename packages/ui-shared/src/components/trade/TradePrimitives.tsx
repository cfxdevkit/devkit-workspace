import { type ReactNode, useEffect, useRef, useState } from "react";
import { Input } from "../Input";

export interface BaseToken {
	address: string;
	symbol: string;
	iconUrl?: string;
}

export const TOKEN_SELECT_WRAPPER_CLASS =
	"select-custom-wrapper !border-transparent !bg-white/5 !px-2.5 !py-1.5 hover:!bg-white/10 transition-all";
export const TOKEN_SELECT_CLASS =
	"select-custom !font-black !text-[11px] !tracking-[0.16em] uppercase";
export const TOKEN_SELECT_ICON_CLASS =
	"pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/40 text-[8px]";

function TokenVisual({
	token,
	size = "h-5 w-5",
}: {
	token: BaseToken | undefined;
	size?: string;
}) {
	if (token?.iconUrl) {
		return (
			<img
				src={token.iconUrl}
				alt=""
				className={`${size} rounded-full object-contain shadow-md`}
				onError={(e) => {
					(e.target as HTMLImageElement).style.display = "none";
				}}
			/>
		);
	}

	return (
		<div
			className={`flex ${size} items-center justify-center rounded-full bg-white/10 text-[8px] font-black uppercase text-text-secondary`}
		>
			{token?.symbol?.[0] ?? "?"}
		</div>
	);
}

function TradeTokenPicker({
	tokens,
	selectedIndex,
	onTokenChange,
}: {
	tokens: BaseToken[];
	selectedIndex: number;
	onTokenChange: (nextIndex: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const selectedToken = tokens[selectedIndex];

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [open]);

	return (
		<div ref={rootRef} className={`relative ${open ? "z-[220]" : "z-[120]"}`}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className={`${TOKEN_SELECT_WRAPPER_CLASS} min-w-[112px] justify-between rounded-[1rem] !border-transparent !bg-white/6 !pr-9 text-white shadow-inner hover:!bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35`}
				aria-haspopup="listbox"
				aria-expanded={open}
			>
				<div className="flex min-w-0 items-center gap-2.5">
					<TokenVisual token={selectedToken} />
					<span className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-white">
						{selectedToken?.symbol ?? "Token"}
					</span>
				</div>
				<span
					className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-secondary/45 transition-transform duration-200"
					aria-hidden="true"
				>
					{open ? "▲" : "▼"}
				</span>
			</button>

			{open && (
				<div className="absolute right-0 top-[calc(100%+0.75rem)] z-[240] w-[220px] overflow-hidden rounded-[1.35rem] border border-black/20 bg-bg-secondary/95 p-2 shadow-2xl shadow-black/45 ring-1 ring-black/20 backdrop-blur-2xl animate-fade-in-up">
					<div className="max-h-[280px] overflow-auto pr-1">
						<div className="grid gap-1.5">
							{tokens.map((entry, index) => {
								const active = index === selectedIndex;
								return (
									<button
										key={entry.address}
										type="button"
										onClick={() => {
											onTokenChange(index);
											setOpen(false);
										}}
										className={`flex w-full items-center gap-3 rounded-[1rem] border px-3 py-2.5 text-left transition-all ${active ? "border-accent/35 bg-accent/14 text-white shadow-lg shadow-accent/10" : "border-transparent bg-transparent text-text-secondary hover:bg-white/6 hover:text-white"}`}
										role="option"
										aria-selected={active}
									>
										<TokenVisual token={entry} size="h-8 w-8" />
										<div className="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.16em]">
											{entry.symbol}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

interface TradeTokenFieldProps {
	label: string;
	sideLabel: string;
	amount: string;
	onAmountChange?: (value: string) => void;
	tokens: BaseToken[];
	selectedIndex: number;
	onTokenChange: (nextIndex: number) => void;
	readonlyAmount?: boolean;
}

export function TradeTokenField({
	label,
	sideLabel,
	amount,
	onAmountChange,
	tokens,
	selectedIndex,
	onTokenChange,
	readonlyAmount = false,
}: TradeTokenFieldProps) {
	const _token = tokens[selectedIndex];

	return (
		<div className="rounded-[1.35rem] border border-white/5 bg-bg-secondary/40 p-4 shadow-lg transition-all duration-300 focus-within:border-accent/40 focus-within:bg-bg-secondary/60">
			<div className="mb-3 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.18em] text-text-secondary/65">
				<span>{label}</span>
				<span className="text-accent/60 italic">{sideLabel}</span>
			</div>
			<div className="flex items-center gap-3">
				{readonlyAmount ? (
					<div className="flex-1 font-mono text-[1.7rem] font-black tracking-tight text-white tabular-nums">
						{amount || "0.0"}
					</div>
				) : (
					<Input
						type="text"
						placeholder="0.0"
						value={amount}
						onChange={(event) => onAmountChange?.(event.target.value)}
						className="flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[1.7rem] font-black tracking-tight text-white tabular-nums shadow-none focus:ring-0 placeholder:text-white/5"
					/>
				)}
				<TradeTokenPicker
					tokens={tokens}
					selectedIndex={selectedIndex}
					onTokenChange={onTokenChange}
				/>
			</div>
		</div>
	);
}

export function TradeSummaryGrid({
	items,
}: {
	items: Array<{ label: string; value: string; tone?: "default" | "accent" }>;
}) {
	return (
		<div className="grid gap-3 rounded-[1.35rem] border border-white/5 bg-white/5 p-4 shadow-inner sm:grid-cols-2 lg:grid-cols-4">
			{items.map((item) => (
				<div key={item.label} className="flex flex-col gap-1">
					<div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/55 italic">
						{item.label}
					</div>
					<div
						className={`truncate text-[11px] font-black tracking-widest uppercase ${item.tone === "accent" ? "text-accent" : "text-white"}`}
					>
						{item.value}
					</div>
				</div>
			))}
		</div>
	);
}

export function TradeActionBar({ children }: { children: ReactNode }) {
	return (
		<div className="mt-5 flex flex-col items-stretch gap-3 rounded-[1.35rem] border border-white/5 bg-bg-secondary/40 p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between">
			{children}
		</div>
	);
}
