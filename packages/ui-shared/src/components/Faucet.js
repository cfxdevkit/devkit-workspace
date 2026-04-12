import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
const AMOUNTS = [10, 50, 100, 500];
export function Faucet() {
    const { address, isConnected } = useAccount();
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const [faucetBalance, setFaucetBalance] = useState(null);
    const refreshFaucetBalance = useCallback(async () => {
        try {
            const r = await fetch(`/api/accounts/faucet`, { signal: AbortSignal.timeout(5000) });
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
            const res = await fetch(`/api/accounts/fund`, {
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
    if (!isConnected) {
        return (_jsxs("div", { className: "card", children: [_jsx("h2", { className: "text-[1.15rem] font-bold text-gray-200 mb-2", children: "Faucet" }), _jsx("p", { className: "text-sm text-text-secondary", children: "Connect wallet to use faucet" })] }));
    }
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx("h2", { className: "text-[1.15rem] font-bold text-gray-200", children: "Faucet" }), faucetBalance != null && (_jsxs("span", { className: "bg-success/10 text-success px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border border-success/20", children: [faucetBalance.toLocaleString(undefined, { maximumFractionDigits: 0 }), " CFX available"] }))] }), _jsx("p", { className: "text-sm text-text-secondary mb-4", children: "Fund your wallet with test CFX from the local server" }), _jsx("div", { className: "flex gap-2 flex-wrap sm:flex-nowrap", children: AMOUNTS.map((amt) => {
                    const insufficient = faucetBalance != null && faucetBalance < amt;
                    return (_jsxs("button", { type: "button", onClick: () => fund(amt), disabled: loading || insufficient, className: `flex-1 py-1.5 px-3 rounded-lg border font-semibold text-sm transition-all
                ${insufficient
                            ? 'border-border bg-transparent text-text-secondary opacity-50 cursor-not-allowed'
                            : 'border-success/30 bg-success/10 text-success hover:bg-success/20 hover:border-success/50 active:scale-95'}`, title: insufficient ? 'Insufficient faucet balance' : `Fund ${amt} CFX`, children: [_jsx("span", { className: "tabular-nums", children: amt }), " CFX"] }, amt));
                }) }), status && (_jsx("p", { className: `text-sm mt-3 animate-fade-in ${status.startsWith('✓') ? 'text-success' : status.startsWith('Error') ? 'text-error' : 'text-text-secondary'}`, children: status }))] }));
}
