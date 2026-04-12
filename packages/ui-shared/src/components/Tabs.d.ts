import { type ReactNode } from 'react';
export declare function Tabs({ activeTab, onTabChange, children }: {
    activeTab: string;
    onTabChange: (value: string) => void;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function TabsList({ children, className }: {
    children: ReactNode;
    className?: string;
}): import("react/jsx-runtime").JSX.Element;
export declare function TabsTrigger({ value, children }: {
    value: string;
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export declare function TabsContent({ value, children, className }: {
    value: string;
    children: ReactNode;
    className?: string;
}): import("react/jsx-runtime").JSX.Element | null;
//# sourceMappingURL=Tabs.d.ts.map