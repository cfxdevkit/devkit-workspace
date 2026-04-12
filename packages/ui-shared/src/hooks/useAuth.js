import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useRef, useState, } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
function buildSiweMessage(p) {
    return [
        `${p.domain} wants you to sign in with your Ethereum account:`,
        p.address,
        '',
        'Sign in to CFX DevKit',
        '',
        `URI: ${p.uri}`,
        'Version: 1',
        `Chain ID: ${p.chainId}`,
        `Nonce: ${p.nonce}`,
        `Issued At: ${p.issuedAt}`,
    ].join('\n');
}
const AuthContext = createContext(null);
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error('useAuth must be inside AuthProvider');
    return ctx;
}
export function AuthProvider({ children }) {
    const { address, isConnected, chainId } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const attemptedRef = useRef(null);
    useEffect(() => {
        if (!address) {
            setIsAuthenticated(false);
            return;
        }
        fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
            if (data?.address?.toLowerCase() === address.toLowerCase()) {
                setIsAuthenticated(true);
                attemptedRef.current = address;
            }
        })
            .catch(() => { });
    }, [address]);
    useEffect(() => {
        if (!isConnected) {
            setIsAuthenticated(false);
            setError(null);
            attemptedRef.current = null;
        }
    }, [isConnected]);
    const signIn = useCallback(async () => {
        if (!address || !chainId)
            return;
        setIsLoading(true);
        setError(null);
        try {
            const nr = await fetch(`${import.meta.env.BASE_URL}api/auth/nonce`, { credentials: 'include' });
            if (!nr.ok)
                throw new Error('Failed to get nonce');
            const { nonce } = await nr.json();
            const message = buildSiweMessage({
                domain: window.location.host,
                address,
                uri: window.location.origin,
                chainId,
                nonce,
                issuedAt: new Date().toISOString(),
            });
            const signature = await signMessageAsync({ message });
            const vr = await fetch(`${import.meta.env.BASE_URL}api/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, signature }),
                credentials: 'include',
            });
            if (!vr.ok) {
                const body = await vr.json().catch(() => ({}));
                throw new Error(body.error || 'Verification failed');
            }
            setIsAuthenticated(true);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Sign-in failed';
            if (/reject|denied|cancel/i.test(msg)) {
                setError(null);
            }
            else {
                setError(msg);
            }
        }
        finally {
            setIsLoading(false);
        }
    }, [address, chainId, signMessageAsync]);
    useEffect(() => {
        if (isConnected && address && !isAuthenticated && attemptedRef.current !== address) {
            attemptedRef.current = address;
            const timeoutId = setTimeout(() => {
                void signIn();
            }, 400);
            return () => clearTimeout(timeoutId);
        }
    }, [isConnected, address, isAuthenticated, signIn]);
    const signOut = useCallback(async () => {
        try {
            await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, { method: 'POST', credentials: 'include' });
        }
        catch { /* ignore */ }
        setIsAuthenticated(false);
        attemptedRef.current = null;
    }, []);
    return (_jsx(AuthContext.Provider, { value: { isAuthenticated, isLoading, error, signIn, signOut }, children: children }));
}
