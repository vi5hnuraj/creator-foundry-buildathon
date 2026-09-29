import { http } from "wagmi";
import type { Chain } from "wagmi/chains";
import { arbitrumSepolia, robinhoodTestnet, ACTIVE_CHAIN } from "./chains";

/**
 * Wagmi chain config for the Arbitrum Open House Buildathon.
 * Primary deployment target: Arbitrum Sepolia. Robinhood Chain testnet
 * (Arbitrum Orbit) supported as a secondary deployment.
 */

const wagmiArbitrumSepolia: Chain = {
  ...arbitrumSepolia,
  rpcUrls: {
    default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] },
  },
};

const wagmiRobinhoodTestnet: Chain = {
  ...robinhoodTestnet,
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
};

export const chains = [wagmiArbitrumSepolia, wagmiRobinhoodTestnet] as const;
export const activeChain = ACTIVE_CHAIN as unknown as Chain;
export const transports = {
  [wagmiArbitrumSepolia.id]: http(),
  [wagmiRobinhoodTestnet.id]: http(),
};

export { projectId } from "./chains-env";
