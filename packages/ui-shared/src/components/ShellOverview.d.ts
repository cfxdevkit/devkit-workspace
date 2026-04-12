import type { ReactNode } from 'react';
interface ShellOverviewProps {
    title: string;
    description: string;
    statusLabel?: string;
    statusVariant?: 'success' | 'warning' | 'error' | 'neutral';
    metrics?: ReactNode;
    children?: ReactNode;
}
export declare function ShellOverview({ title, description, statusLabel, statusVariant, metrics, children }: ShellOverviewProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=ShellOverview.d.ts.map