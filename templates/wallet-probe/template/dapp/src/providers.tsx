import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";

// ──────────────────────────────────────────────────────────────────
// Chains — all three eSpace tiers. Local RPC goes through the Vite
// dev-server proxy (/rpc → localhost:8545).
// ──────────────────────────────────────────────────────────────────
const eSpaceLocal = defineChain({
	id: 2030,
	name: "Conflux eSpace (Local)",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: { default: { http: ["./rpc"] } },
});

const eSpaceTestnet = defineChain({
	id: 71,
	name: "Conflux eSpace (Testnet)",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
	testnet: true,
});

const eSpaceMainnet = defineChain({
	id: 1030,
	name: "Conflux eSpace",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: { default: { http: ["https://evm.confluxrpc.com"] } },
});

const wagmiConfig = createConfig({
	chains: [eSpaceLocal, eSpaceTestnet, eSpaceMainnet],
	connectors: [injected()],
	transports: {
		[eSpaceLocal.id]: http("./rpc"),
		[eSpaceTestnet.id]: http("https://evmtestnet.confluxrpc.com"),
		[eSpaceMainnet.id]: http("https://evm.confluxrpc.com"),
	},
});

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: 0 } },
});

export function Providers({ children }: { children: ReactNode }) {
	return (
		<WagmiProvider config={wagmiConfig}>
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		</WagmiProvider>
	);
}
