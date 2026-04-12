import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext } from 'react';
const TabsContext = createContext(null);
export function Tabs({ activeTab, onTabChange, children }) {
    return (_jsx(TabsContext.Provider, { value: { activeTab, setActiveTab: onTabChange }, children: _jsx("div", { className: "w-full flex flex-col gap-6", children: children }) }));
}
export function TabsList({ children, className = '' }) {
    return (_jsx("div", { className: `flex items-center gap-2 border-b border-border mb-2 ${className}`, children: children }));
}
export function TabsTrigger({ value, children }) {
    const ctx = useContext(TabsContext);
    if (!ctx)
        throw new Error('TabsTrigger must be used within Tabs');
    const isActive = ctx.activeTab === value;
    return (_jsx("button", { type: "button", onClick: () => ctx.setActiveTab(value), className: `px-4 py-2.5 font-semibold text-sm transition-all border-b-2 -mb-[1px] relative z-10 ${isActive
            ? 'border-accent text-accent'
            : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-hover'}`, children: children }));
}
export function TabsContent({ value, children, className = '' }) {
    const ctx = useContext(TabsContext);
    if (!ctx)
        throw new Error('TabsContent must be used within Tabs');
    if (ctx.activeTab !== value)
        return null;
    return (_jsx("div", { className: `animate-fade-in ${className}`, children: children }));
}
