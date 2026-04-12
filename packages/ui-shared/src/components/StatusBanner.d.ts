import type { ReactNode } from 'react';
type StatusTone = 'accent' | 'success' | 'error' | 'warning';
interface StatusBannerProps {
    message: ReactNode;
    tone?: StatusTone;
    className?: string;
    textClassName?: string;
}
export declare function StatusBanner({ message, tone, className, textClassName }: StatusBannerProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=StatusBanner.d.ts.map