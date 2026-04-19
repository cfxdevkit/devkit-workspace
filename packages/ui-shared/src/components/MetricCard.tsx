import type { ReactNode } from "react";

interface MetricCardProps {
	label: string;
	value: string;
	hint: string;
	icon?: ReactNode;
	variant?: "default" | "accent" | "success";
}

export function MetricCard({
	label,
	value,
	hint,
	icon,
	variant = "default",
}: MetricCardProps) {
	const variantStyles = {
		default: "hover:border-white/20",
		accent: "border-accent/20 bg-accent/5 hover:border-accent/40",
		success: "border-success/20 bg-success/5 hover:border-success/40",
	};

	return (
		<div
			className={`group rounded-[1.25rem] border border-white/5 bg-bg-secondary/40 px-4 py-3.5 shadow-lg shadow-black/10 backdrop-blur-md transition-all duration-300 ${variantStyles[variant]} hover:bg-bg-secondary/60`}
		>
			<div className="flex items-center justify-between">
				<div className="text-[9px] font-black uppercase tracking-[0.18em] text-text-secondary/75 transition-colors group-hover:text-text-secondary italic">
					{label}
				</div>
				{icon && <div className="text-text-secondary/40">{icon}</div>}
			</div>
			<div
				className={`mt-1.5 text-[1.35rem] font-black tracking-tight text-white transition-colors group-hover:text-white uppercase ${variant === "accent" ? "text-accent" : variant === "success" ? "text-success" : ""}`}
			>
				{value}
			</div>
			<div className="mt-1 text-[8px] text-text-secondary/55 uppercase font-black tracking-[0.18em] transition-colors group-hover:text-text-secondary/75">
				{hint}
			</div>
		</div>
	);
}
