import type { ReactNode } from "react";

interface ShellOverviewProps {
	title: string;
	description: string;
	statusLabel?: string;
	statusVariant?: "success" | "warning" | "error" | "neutral";
	metrics?: ReactNode;
	children?: ReactNode;
}

export function ShellOverview({
	title,
	description,
	statusLabel,
	statusVariant = "neutral",
	metrics,
	children,
}: ShellOverviewProps) {
	const statusStyles = {
		success: "bg-success text-success",
		warning: "bg-warning text-warning",
		error: "bg-error text-error",
		neutral: "bg-border text-border",
	};

	return (
		<div className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-bg-secondary/30 p-5 md:p-6 backdrop-blur-2xl shadow-2xl">
			{/* Decorative background gradients */}
			<div className="absolute top-0 left-0 -ml-20 -mt-20 w-96 h-96 bg-accent/20 rounded-full blur-[120px] pointer-events-none opacity-40 animate-pulse" />
			<div className="absolute bottom-0 right-0 -mr-20 -mb-20 w-96 h-96 bg-success/10 rounded-full blur-[120px] pointer-events-none opacity-40" />

			<div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
				<div className="max-w-2xl">
					{statusLabel && (
						<div className="mb-3 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-bg-primary/40 px-3 py-1 text-[9px] font-black uppercase tracking-[0.22em] text-text-secondary shadow-inner">
							<span
								className={`h-2 w-2 rounded-full shadow-[0_0_8px_currentColor] ${statusStyles[statusVariant]} ${statusVariant === "success" ? "animate-pulse" : ""}`}
							/>
							{statusLabel}
						</div>
					)}
					<h1 className="text-3xl font-black tracking-tight text-white leading-tight md:text-4xl lg:text-[2.8rem]">
						{title}
					</h1>
					<p className="mt-3 max-w-xl text-sm leading-relaxed text-text-secondary font-medium opacity-80 md:text-[15px]">
						{description}
					</p>
					{children && <div className="mt-5">{children}</div>}
				</div>

				{metrics && (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[360px] lg:grid-cols-2 xl:grid-cols-3">
						{metrics}
					</div>
				)}
			</div>
		</div>
	);
}
