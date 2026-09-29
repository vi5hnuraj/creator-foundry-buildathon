/**
 * Creator Foundry — supported chains for the Arbitrum Open House Buildathon.
 *
 * Arbitrum Sepolia (421614) and Robinhood Chain Testnet (46630, an Arbitrum
 * Orbit chain). The rules reserve prizes per chain, so the app runs on both and
 * the active network is chosen by env (NEXT_PUBLIC_CHAIN).
 *
 * CONTRACT ADDRESSES ARE PER-CHAIN, and the deployment that last ran used to
 * overwrite the others — so switching chains pointed at the wrong contracts.
 * Resolvers below read `contracts/deployments.json` (the registry
 * scripts/deploy.mjs writes) for the ACTIVE chain first, and only fall back to
 * the flat NEXT_PUBLIC_* env vars when the registry has no entry for that chain.
 */
import deployments from "../../contracts/deployments.json";

// Minimal Chain type compatible with wagmi's Chain (we only need id/name/rpc/explorer).
export type AppChain = {
  id: number;
  name: string;
  network: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: { default: { http: string[] } };
  blockExplorers: {
    default: { name: string; url: string };
    etherscan?: { name: string; url: string };
  };
  testnet: boolean;
};

export const arbitrumSepolia: AppChain = {
  id: 421614,
  name: "Arbitrum Sepolia",
  network: "arbitrum-sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
  blockExplorers: {
    default: { name: "Arbiscan Sepolia", url: "https://sepolia.arbiscan.io" },
    etherscan: { name: "Arbiscan Sepolia", url: "https://sepolia.arbiscan.io" },
  },
  testnet: true,
};

export const robinhoodTestnet: AppChain = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  network: "robinhood-testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
};

export const SUPPORTED_CHAINS = [arbitrumSepolia, robinhoodTestnet] as const;

export type ChainKey = "arbitrum-sepolia" | "robinhood-testnet";

/** One chain's deployed contracts, as recorded in deployments.json. */
export type ChainDeployment = {
  label: string;
  chainId: number;
  explorer: string;
  usdg: string;
  nft: string | null;
  splits: string | null;
  escrow: string | null;
  primary?: boolean;
  note?: string;
};

const REGISTRY = deployments.chains as Record<string, ChainDeployment>;

/** Every chain the registry knows about — used by the deploy script + verifier. */
export const DEPLOYMENTS = REGISTRY;

/** The chain deployments.json marks as the primary demo network, if any. */
export const PRIMARY_CHAIN_KEY: ChainKey = (Object.keys(REGISTRY).find(
  (k) => REGISTRY[k]?.primary
) as ChainKey | undefined) ?? "arbitrum-sepolia";

export const CHAIN_KEYS: Record<ChainKey, AppChain> = {
  "arbitrum-sepolia": arbitrumSepolia,
  "robinhood-testnet": robinhoodTestnet,
};

function isChainKey(v: string | undefined): v is ChainKey {
  return v === "arbitrum-sepolia" || v === "robinhood-testnet";
}

/** Active chain for this deployment, selected via NEXT_PUBLIC_CHAIN. */
export const ACTIVE_CHAIN_KEY: ChainKey = (() => {
  const key = process.env.NEXT_PUBLIC_CHAIN;
  if (isChainKey(key)) return key;
  return "arbitrum-sepolia"; // buildathon default
})();

export const ACTIVE_CHAIN: AppChain = CHAIN_KEYS[ACTIVE_CHAIN_KEY];

/** The registry entry for the active chain (undefined if it isn't recorded yet). */
export const ACTIVE_DEPLOYMENT: ChainDeployment | undefined = REGISTRY[ACTIVE_CHAIN_KEY];

/** A deployed address, or null. Zero addresses and unset env vars count as none. */
function addressOrNull(v: string | undefined | null): `0x${string}` | null {
  if (!v || v.includes("0x<") || /^0x0+$/.test(v)) return null;
  return v as `0x${string}`;
}

/**
 * CreatorFoundryAssetNFT (ERC-721 + ERC-2981 proof-of-authorship).
 * Registry first — an address is only meaningful on the chain it was deployed
 * to, so a stale flat env var must not win over the active chain's record.
 */
export const NFT_CONTRACT_ADDRESS: `0x${string}` | null =
  addressOrNull(ACTIVE_DEPLOYMENT?.nft) ??
  addressOrNull(process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS);

/** CreatorFoundrySplits (USDG revenue-split distributor). */
export const SPLITS_CONTRACT_ADDRESS: `0x${string}` | null =
  addressOrNull(ACTIVE_DEPLOYMENT?.splits) ??
  addressOrNull(process.env.NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS);

/**
 * Paxos USDG (Global Dollar) — the buildathon's featured stablecoin.
 * Paying creator bounties and revenue splits in USDG earns extra judging
 * consideration. Addresses from docs.paxos.com (verified Sep 2026).
 */
export const USDG_ADDRESSES: Record<ChainKey, `0x${string}`> = {
  "arbitrum-sepolia": "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
  "robinhood-testnet": "0x7E955252E15c84f5768B83c41a71F9eba181802F",
};

export const USDG_ADDRESS: `0x${string}` =
  addressOrNull(ACTIVE_DEPLOYMENT?.usdg) ??
  addressOrNull(process.env.NEXT_PUBLIC_USDG_ADDRESS) ??
  USDG_ADDRESSES[ACTIVE_CHAIN_KEY];

/**
 * CreatorFoundryBountyEscrow — one deployment per chain; written by
 * scripts/deploy.mjs. When the ACTIVE chain has none, the app falls back to a
 * direct producer → contributor transfer, so a chain without the escrow still
 * runs (it just has no lock/refund guarantee).
 */
export const BOUNTY_ESCROW_ADDRESS: `0x${string}` | null =
  addressOrNull(ACTIVE_DEPLOYMENT?.escrow) ??
  addressOrNull(process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS) ??
  addressOrNull(process.env.NEXT_PUBLIC_BOUNTY_ESCROW) ??
  null;

/** True once an escrow contract is configured for the ACTIVE chain. */
export const ESCROW_ENABLED = !!BOUNTY_ESCROW_ADDRESS;

/** True when the active chain's deployment record is incomplete. */
export const DEPLOYMENT_INCOMPLETE = !NFT_CONTRACT_ADDRESS || !SPLITS_CONTRACT_ADDRESS;

/**
 * Chains whose full contract set is recorded. Used by docs/UI and by
 * scripts/verify-onchain.mjs to report the multi-chain deployment surface
 * honestly instead of implying every chain is equally exercised.
 */
export const CHAINS_WITH_FULL_DEPLOYMENT: ChainKey[] = (Object.keys(REGISTRY) as ChainKey[]).filter(
  (k) => !!REGISTRY[k]?.nft && !!REGISTRY[k]?.splits && !!REGISTRY[k]?.escrow
);

/** Client-side ABI for the bounty escrow (subset the UI touches). */
export const BOUNTY_ESCROW_ABI = [
  {
    inputs: [
      { name: "key", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "briefHash", type: "bytes32" },
    ],
    name: "fund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "key", type: "bytes32" },
      { name: "contributor", type: "address" },
      { name: "deliveryWindow", type: "uint64" },
      { name: "reviewWindow", type: "uint64" },
    ],
    name: "assignContributor",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "key", type: "bytes32" },
      { name: "deliveryHash", type: "bytes32" },
    ],
    name: "attestDelivery",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "key", type: "bytes32" },
      { name: "criticScore", type: "uint16" },
    ],
    name: "release",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "key", type: "bytes32" }],
    name: "autoRelease",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "key", type: "bytes32" }],
    name: "refund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "key", type: "bytes32" }],
    name: "releasable",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "key", type: "bytes32" }],
    name: "escrows",
    outputs: [
      { name: "producer", type: "address" },
      { name: "contributor", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "fundedAt", type: "uint64" },
      { name: "deliveryDeadline", type: "uint64" },
      { name: "reviewDeadline", type: "uint64" },
      { name: "attested", type: "bool" },
      { name: "released", type: "bool" },
      // NOTE: every field below must mirror the contract's Escrow struct in
      // ORDER. Omitting `refunded` here shifted the tuple by one, so the reader
      // decoded `briefHash` into the `refunded` slot and `criticScore` from the
      // low 16 bits of `deliveryHash` — a wrong number with no error raised.
      { name: "refunded", type: "bool" },
      { name: "briefHash", type: "bytes32" },
      { name: "deliveryHash", type: "bytes32" },
      { name: "criticScore", type: "uint16" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** ERC-20 ABI subset used by the client for USDG payments. */
export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    // ERC-20: allowance returns uint256, not bool (this read drives the
    // escrow's "skip the approve step if already funded" check).
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;
