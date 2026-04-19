import type { ReactNode } from "react";

interface SectionHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	right?: ReactNode;
	className?: string;
	titleClassName?: string;
	descriptionClassName?: string;
	rightClassName?: string;
}

export function SectionHeader({
	title,
	description,
	right,
	className = "",
	titleClassName = "",
	descriptionClassName = "",
	rightClassName = "",
}: SectionHeaderProps) {
	return (
		<div
			className={`relative mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
		>
			<div>
				<h2
					className={`text-2xl font-black tracking-tighter text-white uppercase leading-none ${titleClassName}`}
				>
					{title}
				</h2>
				{description ? (
					<p
						className={`mt-1 text-xs font-medium italic text-text-secondary/60 ${descriptionClassName}`}
					>
						{description}
					</p>
				) : null}
			</div>
			{right ? <div className={rightClassName}>{right}</div> : null}
		</div>
	);
}
