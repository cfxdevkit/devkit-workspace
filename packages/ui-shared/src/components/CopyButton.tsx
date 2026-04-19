import { useState } from "react";

interface CopyButtonProps {
	copyText: string;
	title?: string;
	className?: string;
	size?: "sm" | "md";
	stopPropagation?: boolean;
}

export function CopyButton({
	copyText,
	title,
	className = "",
	size = "sm",
	stopPropagation = false,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	const sizeClasses =
		size === "md"
			? {
					button: "h-8 w-8 rounded-xl",
					icon: "h-[18px] w-[18px]",
					check: "text-[16px]",
				}
			: {
					button: "h-7 w-7 rounded-md",
					icon: "h-[16px] w-[16px]",
					check: "text-[15px]",
				};

	const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
		if (stopPropagation) event.stopPropagation();
		try {
			await navigator.clipboard.writeText(copyText);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Ignore clipboard failures.
		}
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			title={title ?? copyText}
			className={`inline-flex items-center justify-center bg-bg-tertiary/90 text-text-secondary transition-colors hover:bg-accent/10 hover:text-text-primary ${sizeClasses.button} ${className}`}
		>
			{copied ? (
				<span className={`${sizeClasses.check} leading-none`}>✓</span>
			) : (
				<svg
					viewBox="0 0 24 24"
					aria-hidden="true"
					className={`${sizeClasses.icon} fill-none stroke-current stroke-[1.9]`}
				>
					<rect x="9" y="9" width="10" height="10" rx="2" />
					<path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
				</svg>
			)}
		</button>
	);
}
