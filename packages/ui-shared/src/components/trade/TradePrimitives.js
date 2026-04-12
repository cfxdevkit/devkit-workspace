import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Input } from '../Input';
export const TOKEN_SELECT_WRAPPER_CLASS = 'select-custom-wrapper !border-transparent !bg-white/5 !px-2.5 !py-1.5 hover:!bg-white/10 transition-all';
export const TOKEN_SELECT_CLASS = 'select-custom !font-black !text-[11px] !tracking-[0.16em] uppercase';
export const TOKEN_SELECT_ICON_CLASS = 'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/40 text-[8px]';
function TokenVisual({ token, size = 'h-5 w-5' }) {
    if (token?.iconUrl) {
        return _jsx("img", { src: token.iconUrl, alt: "", className: `${size} rounded-full object-contain shadow-md`, onError: (e) => { e.target.style.display = 'none'; } });
    }
    return _jsx("div", { className: `flex ${size} items-center justify-center rounded-full bg-white/10 text-[8px] font-black uppercase text-text-secondary`, children: token?.symbol?.[0] ?? '?' });
}
function TradeTokenPicker({ tokens, selectedIndex, onTokenChange, }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const selectedToken = tokens[selectedIndex];
    useEffect(() => {
        if (!open)
            return;
        const handlePointerDown = (event) => {
            if (!rootRef.current?.contains(event.target)) {
                setOpen(false);
            }
        };
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [open]);
    return (_jsxs("div", { ref: rootRef, className: `relative ${open ? 'z-[220]' : 'z-[120]'}`, children: [_jsxs("button", { type: "button", onClick: () => setOpen((value) => !value), className: `${TOKEN_SELECT_WRAPPER_CLASS} min-w-[112px] justify-between rounded-[1rem] !border-transparent !bg-white/6 !pr-9 text-white shadow-inner hover:!bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35`, "aria-haspopup": "listbox", "aria-expanded": open, children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2.5", children: [_jsx(TokenVisual, { token: selectedToken }), _jsx("span", { className: "truncate text-[11px] font-black uppercase tracking-[0.16em] text-white", children: selectedToken?.symbol ?? 'Token' })] }), _jsx("span", { className: "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-secondary/45 transition-transform duration-200", "aria-hidden": "true", children: open ? '▲' : '▼' })] }), open && (_jsx("div", { className: "absolute right-0 top-[calc(100%+0.75rem)] z-[240] w-[220px] overflow-hidden rounded-[1.35rem] border border-black/20 bg-bg-secondary/95 p-2 shadow-2xl shadow-black/45 ring-1 ring-black/20 backdrop-blur-2xl animate-fade-in-up", children: _jsx("div", { className: "max-h-[280px] overflow-auto pr-1", children: _jsx("div", { className: "grid gap-1.5", children: tokens.map((entry, index) => {
                            const active = index === selectedIndex;
                            return (_jsxs("button", { type: "button", onClick: () => {
                                    onTokenChange(index);
                                    setOpen(false);
                                }, className: `flex w-full items-center gap-3 rounded-[1rem] border px-3 py-2.5 text-left transition-all ${active ? 'border-accent/35 bg-accent/14 text-white shadow-lg shadow-accent/10' : 'border-transparent bg-transparent text-text-secondary hover:bg-white/6 hover:text-white'}`, role: "option", "aria-selected": active, children: [_jsx(TokenVisual, { token: entry, size: "h-8 w-8" }), _jsx("div", { className: "min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.16em]", children: entry.symbol })] }, entry.address));
                        }) }) }) }))] }));
}
export function TradeTokenField({ label, sideLabel, amount, onAmountChange, tokens, selectedIndex, onTokenChange, readonlyAmount = false, }) {
    const _token = tokens[selectedIndex];
    return (_jsxs("div", { className: "rounded-[1.35rem] border border-white/5 bg-bg-secondary/40 p-4 shadow-lg transition-all duration-300 focus-within:border-accent/40 focus-within:bg-bg-secondary/60", children: [_jsxs("div", { className: "mb-3 flex items-center justify-between text-[8px] font-black uppercase tracking-[0.18em] text-text-secondary/65", children: [_jsx("span", { children: label }), _jsx("span", { className: "text-accent/60 italic", children: sideLabel })] }), _jsxs("div", { className: "flex items-center gap-3", children: [readonlyAmount ? (_jsx("div", { className: "flex-1 font-mono text-[1.7rem] font-black tracking-tight text-white tabular-nums", children: amount || '0.0' })) : (_jsx(Input, { type: "text", placeholder: "0.0", value: amount, onChange: (event) => onAmountChange?.(event.target.value), className: "flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[1.7rem] font-black tracking-tight text-white tabular-nums shadow-none focus:ring-0 placeholder:text-white/5" })), _jsx(TradeTokenPicker, { tokens: tokens, selectedIndex: selectedIndex, onTokenChange: onTokenChange })] })] }));
}
export function TradeSummaryGrid({ items }) {
    return (_jsx("div", { className: "grid gap-3 rounded-[1.35rem] border border-white/5 bg-white/5 p-4 shadow-inner sm:grid-cols-2 lg:grid-cols-4", children: items.map((item) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("div", { className: "text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/55 italic", children: item.label }), _jsx("div", { className: `truncate text-[11px] font-black tracking-widest uppercase ${item.tone === 'accent' ? 'text-accent' : 'text-white'}`, children: item.value })] }, item.label))) }));
}
export function TradeActionBar({ children }) {
    return _jsx("div", { className: "mt-5 flex flex-col items-stretch gap-3 rounded-[1.35rem] border border-white/5 bg-bg-secondary/40 p-4 shadow-xl sm:flex-row sm:items-center sm:justify-between", children: children });
}
