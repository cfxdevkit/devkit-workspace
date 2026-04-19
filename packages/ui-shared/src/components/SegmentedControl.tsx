interface Option {
	id: string;
	label: string;
}

interface SegmentedControlProps {
	options: Option[];
	activeId: string;
	onChange: (id: string) => void;
	className?: string;
}

export function SegmentedControl({
	options,
	activeId,
	onChange,
	className = "",
}: SegmentedControlProps) {
	return (
		<div
			className={`inline-flex w-full rounded-[1.1rem] border border-white/5 bg-bg-secondary/40 p-0.5 backdrop-blur-md shadow-lg sm:w-fit ${className}`}
		>
			{options.map((option) => {
				const isActive = activeId === option.id;
				return (
					<button
						key={option.id}
						type="button"
						onClick={() => onChange(option.id)}
						className={`flex-1 rounded-[0.9rem] px-4 py-2 text-[9px] font-black uppercase tracking-[0.18em] transition-all duration-300 sm:min-w-[92px] sm:flex-none ${
							isActive
								? "bg-accent text-white shadow-lg shadow-accent/20"
								: "text-text-secondary hover:text-white hover:bg-white/5"
						}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
