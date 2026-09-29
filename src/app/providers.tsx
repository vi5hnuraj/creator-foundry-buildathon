"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  RainbowKitProvider,
  connectorsForWallets,
  darkTheme,
} from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, createConfig, http, useAccount, useReconnect } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { chains, activeChain, projectId, transports } from "@/lib/wagmi";

const connectors = connectorsForWallets(
  [{ groupName: "Injected", wallets: [injectedWallet] }],
  {
    appName: "Creator Foundry",
    projectId,
  }
);

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports,
  ssr: true,
});

function AutoReconnect() {
  const { isConnected } = useAccount();
  const { reconnect } = useReconnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isConnected && !attempted.current) {
      attempted.current = true;
      reconnect();
    }
  }, [isConnected, reconnect]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={activeChain}
          theme={darkTheme({
            accentColor: "#28a0f0",
            accentColorForeground: "#ffffff",
            borderRadius: "medium",
          })}
        >
          <AutoReconnect />
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
