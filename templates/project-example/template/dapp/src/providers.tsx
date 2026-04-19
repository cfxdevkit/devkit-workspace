import { AppToaster, AuthProvider } from "@devkit/ui-shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { injected, metaMask } from "wagmi/connectors";
import { appUrl } from "./app-base";
import {
	confluxLocalESpace,
	confluxMainnetESpace,
	confluxTestnetESpace,
	getRuntimeEspaceChains,
} from "./chains";
import { PROJECT_DEFAULT_CHAIN_ID } from "./generated/project-network";

const chains = getRuntimeEspaceChains(PROJECT_DEFAULT_CHAIN_ID);
const includesLocalChain = chains.some(
	(chain) => chain.id === confluxLocalESpace.id,
);
const eSpaceConnectors = [
	metaMask({ dappMetadata: { name: "CFX DevKit Project Example" } }),
	injected(),
];

const config = createConfig({
	chains,
	connectors: eSpaceConnectors,
	transports: {
		...(includesLocalChain
			? {
					// Local node: proxied through the dev server so localhost:8545 is reachable in code-server
					[confluxLocalESpace.id]: http(appUrl("rpc")),
				}
			: {}),
		// Public networks: connect directly to the public RPC
		[confluxTestnetESpace.id]: http("https://evmtestnet.confluxrpc.com"),
		[confluxMainnetESpace.id]: http("https://evm.confluxrpc.com"),
	},
});

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 8_000, refetchOnWindowFocus: true, retry: 1 },
	},
});

export function Providers({ children }: { children: ReactNode }) {
	return (
		<WagmiProvider config={config}>
			<QueryClientProvider client={queryClient}>
				<AuthProvider>{children}</AuthProvider>
				<AppToaster />
			</QueryClientProvider>
		</WagmiProvider>
	);
}
