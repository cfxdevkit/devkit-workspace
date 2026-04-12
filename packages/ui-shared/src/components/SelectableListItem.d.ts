import type { ReactNode } from 'react';
interface SelectableListItemProps {
    active?: boolean;
    onClick?: () => void;
    icon?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    meta?: ReactNode;
    end?: ReactNode;
    className?: string;
    titleClassName?: string;
    subtitleClassName?: string;
    metaClassName?: string;
}
export declare function SelectableListItem({ active, onClick, icon, title, subtitle, meta, end, className, titleClassName, subtitleClassName, metaClassName, }: SelectableListItemProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=SelectableListItem.d.ts.map