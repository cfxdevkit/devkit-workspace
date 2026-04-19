import { useEffect, useRef, useState } from "react";

export interface SelectMenuOption {
	value: string;
	label: string;
	iconUrl?: string;
}

interface SelectMenuProps {
	options: SelectMenuOption[];
	value: string;
	onChange: (nextValue: string) => void;
	disabled?: boolean;
	className?: string;
	menuClassName?: string;
}

function OptionIcon({
	option,
	size = "h-5 w-5",
}: {
	option: SelectMenuOption | undefined;
	size?: string;
}) {
	if (option?.iconUrl) {
		return (
			<img
				src={option.iconUrl}
				alt=""
				className={`${size} rounded-full object-contain shadow-md`}
				onError={(event) => {
					(event.target as HTMLImageElement).style.display = "none";
				}}
			/>
		);
	}

	return (
		<div
			className={`flex ${size} items-center justify-center rounded-full bg-white/10 text-[8px] font-black uppercase text-text-secondary`}
		>
			{option?.label?.[0] ?? "?"}
		</div>
	);
}

export function SelectMenu({
	options,
	value,
	onChange,
	disabled = false,
	className = "",
	menuClassName = "",
}: SelectMenuProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const selectedOption =
		options.find((entry) => entry.value === value) ?? options[0];

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
		<div
			ref={rootRef}
			className={`relative ${open ? "z-[220]" : "z-[120]"} ${className}`}
		>
			<button
				type="button"
				onClick={() => !disabled && setOpen((current) => !current)}
				disabled={disabled}
				className="select-custom-wrapper flex min-h-[44px] w-full justify-between rounded-[1rem] !border-transparent !bg-white/6 !px-3 !py-2 text-white shadow-inner hover:!bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
				aria-haspopup="listbox"
				aria-expanded={open}
			>
				<div className="flex min-w-0 items-center gap-2.5">
					<OptionIcon option={selectedOption} />
					<span className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-white">
						{selectedOption?.label ?? "Select"}
					</span>
				</div>
				<span
					className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-secondary/45"
					aria-hidden="true"
				>
					{open ? "▲" : "▼"}
				</span>
			</button>

			{open && (
				<div
					className={`absolute left-0 top-[calc(100%+0.75rem)] z-[240] w-full overflow-hidden rounded-[1.35rem] border border-black/20 bg-bg-secondary/95 p-2 shadow-2xl shadow-black/45 ring-1 ring-black/20 backdrop-blur-2xl animate-fade-in-up ${menuClassName}`}
				>
					<div className="max-h-[280px] overflow-auto pr-1">
						<div className="grid gap-1.5">
							{options.map((option) => {
								const active = option.value === selectedOption?.value;
								return (
									<button
										key={option.value}
										type="button"
										onClick={() => {
											onChange(option.value);
											setOpen(false);
										}}
										className={`flex w-full items-center gap-3 rounded-[1rem] border px-3 py-2.5 text-left transition-all ${active ? "border-accent/35 bg-accent/14 text-white shadow-lg shadow-accent/10" : "border-transparent bg-transparent text-text-secondary hover:bg-white/6 hover:text-white"}`}
										role="option"
										aria-selected={active}
									>
										<OptionIcon option={option} size="h-8 w-8" />
										<div className="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.16em]">
											{option.label}
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
