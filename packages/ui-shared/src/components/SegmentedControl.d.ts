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
export declare function SegmentedControl({ options, activeId, onChange, className }: SegmentedControlProps): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=SegmentedControl.d.ts.map