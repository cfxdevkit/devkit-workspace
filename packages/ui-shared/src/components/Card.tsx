import type { ReactNode } from "react";

export function Card({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`bg-bg-secondary border border-border rounded-xl p-5 text-text-primary shadow-sm ${className}`}
		>
			{children}
		</div>
	);
}
