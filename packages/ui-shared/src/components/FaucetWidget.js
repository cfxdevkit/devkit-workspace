import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { Button } from './Button';
const AMOUNTS = [10, 50, 100, 500];
export function FaucetWidget({ children }) {
    const { address, isConnected } = useAccount();
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const [faucetBalance, setFaucetBalance] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const refreshFaucetBalance = useCallback(async () => {
        try {
            const r = await fetch(`${import.meta.env.BASE_URL}api/accounts/faucet`, { signal: AbortSignal.timeout(5000) });
            if (!r.ok)
                return;
            const data = await r.json();
            const raw = data?.coreBalance ?? data?.evmBalance;
            if (raw != null) {
                setFaucetBalance(Number(raw));
            }
        }
        catch { /* ignore */ }
    }, []);
    useEffect(() => {
        refreshFaucetBalance();
        const iv = setInterval(refreshFaucetBalance, 15_000);
        return () => clearInterval(iv);
    }, [refreshFaucetBalance]);
    const fund = async (amount) => {
        if (!address)
            return;
        setLoading(true);
        setStatus(`Funding ${amount} CFX…`);
        try {
            const res = await fetch(`${import.meta.env.BASE_URL}api/accounts/fund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, amount: String(amount), chain: 'evm' }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || body.detail || `HTTP ${res.status}`);
            }
            setStatus(`✓ Funded ${amount} CFX`);
            setTimeout(refreshFaucetBalance, 2000);
        }
        catch (err) {
            setStatus(`Error: ${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`);
        }
        finally {
            setLoading(false);
        }
    };
    if (!isConnected)
        return null;
    return (_jsxs("div", { className: "fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3 pointer-events-none", children: [isOpen && (_jsxs("div", { className: "bg-bg-secondary/95 backdrop-blur-xl border border-border shadow-2xl rounded-2xl p-5 w-[320px] pointer-events-auto animate-in fade-in slide-in-from-bottom-5 duration-300", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h3", { className: "text-lg font-bold text-text-primary tracking-tight", children: "Local Faucet" }), _jsx("button", { type: "button", onClick: () => setIsOpen(false), className: "text-text-secondary hover:text-text-primary p-1 rounded-lg transition-colors", children: _jsxs("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("title", { children: "Close faucet" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" })] }) })] }), children ? _jsx("div", { className: "mb-4", children: children }) : null, _jsxs("div", { className: "bg-bg-tertiary rounded-xl p-3 mb-4 border border-border flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-bold text-text-secondary uppercase tracking-wider", children: "Faucet Reserve" }), _jsxs("span", { className: "text-sm font-mono text-success font-bold", children: [faucetBalance?.toLocaleString() ?? '...', " ", _jsx("span", { className: "text-[10px] opacity-70", children: "CFX" })] })] }), _jsx("p", { className: "text-xs text-text-secondary/80 mb-4 leading-relaxed", children: "Request test tokens for local development. Funds are sent to your connected wallet." }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: AMOUNTS.map((amt) => {
                            const insufficient = faucetBalance != null && faucetBalance < amt;
                            return (_jsxs("button", { type: "button", onClick: () => fund(amt), disabled: loading || insufficient, className: `py-2 px-3 rounded-lg border font-bold text-xs transition-all flex flex-col items-center gap-0.5
                    ${insufficient
                                    ? 'border-border bg-transparent text-text-secondary opacity-50 cursor-not-allowed'
                                    : 'border-accent/20 bg-accent/5 text-accent hover:bg-accent/10 hover:border-accent/40 active:scale-95'}`, children: [_jsx("span", { className: "text-sm text-text-primary", children: amt }), _jsx("span", { className: "opacity-70", children: "CFX" })] }, amt));
                        }) }), status && (_jsx("div", { className: `mt-4 p-3 rounded-lg border text-xs font-medium animate-fade-in ${status.startsWith('✓') ? 'bg-success/10 border-success/20 text-success' :
                            status.startsWith('Error') ? 'bg-error/10 border-error/20 text-error' :
                                'bg-accent/10 border-accent/20 text-accent'}`, children: status }))] })), _jsx(Button, { onClick: () => setIsOpen(!isOpen), variant: "primary", className: `w-14 h-14 rounded-full shadow-2xl flex items-center justify-center pointer-events-auto transform transition-transform hover:scale-110 active:scale-90 ${isOpen ? 'rotate-45' : ''}`, children: isOpen ? (_jsxs("svg", { className: "w-6 h-6", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("title", { children: "Close faucet" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2.5, d: "M6 18L18 6M6 6l12 12" })] })) : (_jsxs("svg", { className: "w-6 h-6", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [_jsx("title", { children: "Open faucet" }), _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M13 10V3L4 14h7v7l9-11h-7z" })] })) })] }));
}
