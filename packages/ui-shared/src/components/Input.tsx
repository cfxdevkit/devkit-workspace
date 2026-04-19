import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<
	HTMLInputElement,
	InputHTMLAttributes<HTMLInputElement>
>(({ className = "", ...props }, ref) => {
	return (
		<input
			ref={ref}
			className={`w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary text-sm shadow-sm outline-none transition-colors border-border-hover focus:border-accent focus:ring-1 focus:ring-accent/50 ${className}`}
			{...props}
		/>
	);
});

Input.displayName = "Input";
