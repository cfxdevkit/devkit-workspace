import { createContext, type ReactNode, useContext } from "react";

interface TabsContextType {
	activeTab: string;
	setActiveTab: (value: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

export function Tabs({
	activeTab,
	onTabChange,
	children,
}: {
	activeTab: string;
	onTabChange: (value: string) => void;
	children: ReactNode;
}) {
	return (
		<TabsContext.Provider value={{ activeTab, setActiveTab: onTabChange }}>
			<div className="w-full flex flex-col gap-6">{children}</div>
		</TabsContext.Provider>
	);
}

export function TabsList({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`flex items-center gap-2 border-b border-border mb-2 ${className}`}
		>
			{children}
		</div>
	);
}

export function TabsTrigger({
	value,
	children,
}: {
	value: string;
	children: ReactNode;
}) {
	const ctx = useContext(TabsContext);
	if (!ctx) throw new Error("TabsTrigger must be used within Tabs");

	const isActive = ctx.activeTab === value;

	return (
		<button
			type="button"
			onClick={() => ctx.setActiveTab(value)}
			className={`px-4 py-2.5 font-semibold text-sm transition-all border-b-2 -mb-[1px] relative z-10 ${
				isActive
					? "border-accent text-accent"
					: "border-transparent text-text-secondary hover:text-text-primary hover:border-border-hover"
			}`}
		>
			{children}
		</button>
	);
}

export function TabsContent({
	value,
	children,
	className = "",
}: {
	value: string;
	children: ReactNode;
	className?: string;
}) {
	const ctx = useContext(TabsContext);
	if (!ctx) throw new Error("TabsContent must be used within Tabs");

	if (ctx.activeTab !== value) return null;

	return <div className={`animate-fade-in ${className}`}>{children}</div>;
}
