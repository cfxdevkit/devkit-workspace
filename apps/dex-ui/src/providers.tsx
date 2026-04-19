import { AppToaster, AuthProvider } from "@devkit/ui-shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { confluxLocalESpace } from "./chains";

const config = createConfig({
	chains: [confluxLocalESpace],
	transports: {
		[confluxLocalESpace.id]: http(`${import.meta.env.BASE_URL}rpc`),
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
