import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary" | "danger" | "ghost";
	children: ReactNode;
}

export function Button({
	variant = "primary",
	className = "",
	children,
	...props
}: ButtonProps) {
	const baseStyles =
		"px-4 py-2 rounded-lg font-semibold text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2";

	const variants = {
		primary:
			"bg-accent text-white hover:bg-accent-hover shadow-sm border border-transparent",
		secondary:
			"bg-bg-tertiary text-text-primary border border-border hover:border-border-hover hover:bg-bg-tertiary/80",
		danger:
			"bg-error/10 text-error border border-error/30 hover:bg-error/20 hover:border-error/50",
		ghost:
			"bg-transparent text-text-secondary hover:text-text-primary hover:bg-bg-tertiary/50",
	};

	return (
		<button
			type="button"
			className={`${baseStyles} ${variants[variant]} ${className}`}
			{...props}
		>
			{children}
		</button>
	);
}
