import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useAccount, useSignMessage } from "wagmi";

function buildSiweMessage(p: {
	domain: string;
	address: string;
	uri: string;
	chainId: number;
	nonce: string;
	issuedAt: string;
}): string {
	return [
		`${p.domain} wants you to sign in with your Ethereum account:`,
		p.address,
		"",
		"Sign in to CFX DevKit",
		"",
		`URI: ${p.uri}`,
		"Version: 1",
		`Chain ID: ${p.chainId}`,
		`Nonce: ${p.nonce}`,
		`Issued At: ${p.issuedAt}`,
	].join("\n");
}

function supportsLocalAuthApi(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const { hostname, pathname } = window.location;
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		/^(.*\/proxy\/\d+\/)/.test(pathname)
	);
}

function resolveBooleanFlag(value: unknown): boolean | null {
	if (typeof value !== "string") {
		return null;
	}

	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		case "0":
		case "false":
		case "no":
		case "off":
			return false;
		default:
			return null;
	}
}

function isSiweEnabled(): boolean {
	const explicitFlag = resolveBooleanFlag(import.meta.env.VITE_ENABLE_SIWE);
	if (explicitFlag != null) {
		return explicitFlag;
	}

	return supportsLocalAuthApi();
}

async function readJsonIfAvailable(response: Response) {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return null;
	}

	return response.json().catch(() => null);
}

export interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	error: string | null;
	signIn: () => Promise<void>;
	signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be inside AuthProvider");
	return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const { address, isConnected, chainId } = useAccount();
	const { signMessageAsync } = useSignMessage();
	const siweEnabled = isSiweEnabled();
	const authApiAvailable = siweEnabled;

	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const attemptedRef = useRef<string | null>(null);

	useEffect(() => {
		if (!address) {
			setIsAuthenticated(false);
			return;
		}
		if (!siweEnabled) {
			setIsAuthenticated(true);
			attemptedRef.current = address;
			return;
		}
		fetch(`${import.meta.env.BASE_URL}api/auth/me`, { credentials: "include" })
			.then((r) => (r.ok ? readJsonIfAvailable(r) : null))
			.then((data) => {
				if (data?.address?.toLowerCase() === address.toLowerCase()) {
					setIsAuthenticated(true);
					attemptedRef.current = address;
				}
			})
			.catch(() => {});
	}, [address, siweEnabled]);

	useEffect(() => {
		if (!isConnected) {
			setIsAuthenticated(false);
			setError(null);
			attemptedRef.current = null;
		}
	}, [isConnected]);

	const signIn = useCallback(async () => {
		if (!address || !chainId) return;
		if (!siweEnabled) {
			setIsAuthenticated(true);
			setError(null);
			attemptedRef.current = address;
			return;
		}
		setIsLoading(true);
		setError(null);
		try {
			const nr = await fetch(`${import.meta.env.BASE_URL}api/auth/nonce`, {
				credentials: "include",
			});
			if (!nr.ok) throw new Error("Failed to get nonce");
			const nonceBody = await readJsonIfAvailable(nr);
			if (!nonceBody?.nonce) {
				throw new Error(
					"SIWE is enabled but the auth backend did not return JSON.",
				);
			}
			const { nonce } = nonceBody;

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
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message, signature }),
				credentials: "include",
			});
			if (!vr.ok) {
				const body = (await readJsonIfAvailable(vr)) ?? {};
				throw new Error(body.error || "Verification failed");
			}
			setIsAuthenticated(true);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Sign-in failed";
			if (/reject|denied|cancel/i.test(msg)) {
				setError(null);
			} else {
				setError(msg);
			}
		} finally {
			setIsLoading(false);
		}
	}, [address, chainId, signMessageAsync, siweEnabled]);

	useEffect(() => {
		if (
			isConnected &&
			address &&
			!isAuthenticated &&
			attemptedRef.current !== address
		) {
			attemptedRef.current = address;
			const timeoutId = setTimeout(() => {
				void signIn();
			}, 400);
			return () => clearTimeout(timeoutId);
		}
	}, [isConnected, address, isAuthenticated, signIn]);

	const signOut = useCallback(async () => {
		if (!siweEnabled) {
			setIsAuthenticated(false);
			attemptedRef.current = null;
			return;
		}
		try {
			await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, {
				method: "POST",
				credentials: "include",
			});
		} catch {
			/* ignore */
		}
		setIsAuthenticated(false);
		attemptedRef.current = null;
	}, [siweEnabled]);

	return (
		<AuthContext.Provider
			value={{ isAuthenticated, isLoading, error, signIn, signOut }}
		>
			{children}
		</AuthContext.Provider>
	);
}
