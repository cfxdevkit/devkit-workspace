import type { ReactNode } from "react";

interface SelectableListItemProps {
	active?: boolean;
	onClick?: () => void;
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	meta?: ReactNode;
	end?: ReactNode;
	className?: string;
	titleClassName?: string;
	subtitleClassName?: string;
	metaClassName?: string;
}

export function SelectableListItem({
	active = false,
	onClick,
	icon,
	title,
	subtitle,
	meta,
	end,
	className = "",
	titleClassName = "",
	subtitleClassName = "",
	metaClassName = "",
}: SelectableListItemProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex min-w-0 items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${active ? "border-accent/40 bg-accent/10" : "border-white/5 bg-bg-primary/30 hover:border-white/15 hover:bg-bg-primary/40"} ${className}`}
		>
			{icon ? <div className="shrink-0">{icon}</div> : null}
			<div className="flex min-w-0 flex-1 items-start justify-between gap-3">
				<div className="min-w-0 flex-1 overflow-hidden">
					<div
						className={`truncate text-sm font-black uppercase tracking-tight text-white ${titleClassName}`}
					>
						{title}
					</div>
					{subtitle ? (
						<div
							className={`overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-medium italic text-text-secondary/55 ${subtitleClassName}`}
						>
							{subtitle}
						</div>
					) : null}
					{meta ? (
						<div
							className={`mt-1 truncate text-[8px] font-black uppercase tracking-[0.16em] text-text-secondary/30 ${metaClassName}`}
						>
							{meta}
						</div>
					) : null}
				</div>
				{end ? <div className="shrink-0">{end}</div> : null}
			</div>
		</button>
	);
}
