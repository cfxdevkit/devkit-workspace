import type { ReactNode } from 'react';
interface MetricCardProps {
    label: string;
    value: string;
    hint: string;
    icon?: ReactNode;
    variant?: 'default' | 'accent' | 'success';
}
export declare function MetricCard({ label, value, hint, icon, variant }: MetricCardProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=MetricCard.d.ts.map