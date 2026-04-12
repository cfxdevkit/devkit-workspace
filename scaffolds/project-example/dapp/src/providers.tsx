import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createConfig, http, injected, WagmiProvider } from 'wagmi';
import { appUrl } from './app-base';
import { confluxLocalESpace, confluxTestnetESpace, confluxMainnetESpace } from './chains';
import { PROJECT_DEFAULT_CHAIN_ID } from './generated/project-network';
import { AuthProvider } from '@cfxdevkit/ui-shared';

const allChains = [confluxLocalESpace, confluxTestnetESpace, confluxMainnetESpace] as const;
const preferredChain = allChains.find((chain) => chain.id === PROJECT_DEFAULT_CHAIN_ID) ?? confluxLocalESpace;
const chains = [preferredChain, ...allChains.filter((chain) => chain.id !== preferredChain.id)];

const config = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    // Local node: proxied through the dev server so localhost:8545 is reachable in code-server
    [confluxLocalESpace.id]: http(appUrl('rpc')),
    // Public networks: connect directly to the public RPC
    [confluxTestnetESpace.id]: http('https://evmtestnet.confluxrpc.com'),
    [confluxMainnetESpace.id]: http('https://evm.confluxrpc.com'),
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
        <AuthProvider>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
