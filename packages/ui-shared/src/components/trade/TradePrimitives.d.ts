import { type ReactNode } from 'react';
export interface BaseToken {
    address: string;
    symbol: string;
    iconUrl?: string;
}
export declare const TOKEN_SELECT_WRAPPER_CLASS = "select-custom-wrapper !border-transparent !bg-white/5 !px-2.5 !py-1.5 hover:!bg-white/10 transition-all";
export declare const TOKEN_SELECT_CLASS = "select-custom !font-black !text-[11px] !tracking-[0.16em] uppercase";
export declare const TOKEN_SELECT_ICON_CLASS = "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/40 text-[8px]";
interface TradeTokenFieldProps {
    label: string;
    sideLabel: string;
    amount: string;
    onAmountChange?: (value: string) => void;
    tokens: BaseToken[];
    selectedIndex: number;
    onTokenChange: (nextIndex: number) => void;
    readonlyAmount?: boolean;
}
export declare function TradeTokenField({ label, sideLabel, amount, onAmountChange, tokens, selectedIndex, onTokenChange, readonlyAmount, }: TradeTokenFieldProps): import("react/jsx-runtime").JSX.Element;
export declare function TradeSummaryGrid({ items }: {
    items: Array<{
        label: string;
        value: string;
        tone?: 'default' | 'accent';
    }>;
}): import("react/jsx-runtime").JSX.Element;
export declare function TradeActionBar({ children }: {
    children: ReactNode;
}): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=TradePrimitives.d.ts.map