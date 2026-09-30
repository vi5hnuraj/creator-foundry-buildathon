/**
 * Creator Foundry on-chain contract configuration (Arbitrum Buildathon).
 *
 * Both contracts are deployed by scripts/deploy.mjs and recorded per chain in
 * deployments.json:
 *   nft    — CreatorFoundryAssetNFT (proof-of-authorship)
 *   splits — CreatorFoundrySplits (USDG revenue splits)
 *
 * Without them the app records contributions locally instead of minting.
 */
import { keccak256, toBytes } from "viem";
import {
  ACTIVE_CHAIN,
  USDG_ADDRESS,
  NFT_CONTRACT_ADDRESS as ACTIVE_NFT_ADDRESS,
  SPLITS_CONTRACT_ADDRESS as ACTIVE_SPLITS_ADDRESS,
} from "./chains";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

// Re-exported for call sites that only want the resolved address: the value is
// chosen for the ACTIVE chain (deployments.json first, env fallback).
export const NFT_CONTRACT_ADDRESS: `0x${string}` = ACTIVE_NFT_ADDRESS ?? ZERO;

export const SPLITS_CONTRACT_ADDRESS: `0x${string}` = ACTIVE_SPLITS_ADDRESS ?? ZERO;

export const USDG_CONTRACT_ADDRESS = USDG_ADDRESS;

export const IS_DEMO_MODE = NFT_CONTRACT_ADDRESS === ZERO;

/** CreatorFoundryAssetNFT — mint(to, uri, royaltyReceiver, royaltyBps). */
export const NFT_ABI = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "string", name: "uri", type: "string" },
      { internalType: "address", name: "royaltyReceiver", type: "address" },
      { internalType: "uint96", name: "royaltyBps", type: "uint96" },
    ],
    name: "mint",
    outputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "nextTokenId",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** CreatorFoundrySplits — commitSplit(payees, weights, feeBps), release(), withdraw(). */
export const SPLITS_ABI = [
  {
    inputs: [
      { name: "controller", type: "address" },
      { name: "feeWallet", type: "address" },
      { name: "token", type: "address" },
    ],
    name: "constructor",
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    inputs: [
      { name: "payees_", type: "address[]" },
      { name: "weights_", type: "uint32[]" },
      { name: "feeBps_", type: "uint32" },
    ],
    name: "commitSplit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "release",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "pendingBalance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "totalReleased",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "committed",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * `AssetMinted(uint256 indexed tokenId, address indexed to, address indexed
 * royaltyReceiver, uint96 royaltyBps)` — topic0. The mint transaction returns
 * nothing to the caller, so the ONLY way to learn the real token id is to read
 * it out of this event in the receipt. Minting used to store "pending" instead,
 * which left every minted asset with a broken token id and a dead NFT link.
 */
export const ASSET_MINTED_TOPIC = keccak256(
  toBytes("AssetMinted(uint256,address,address,uint96)")
);

/** Active chain metadata for display. */
export const CHAIN_INFO = {
  id: ACTIVE_CHAIN.id,
  name: ACTIVE_CHAIN.name,
  explorer: ACTIVE_CHAIN.blockExplorers.default.url,
  usdg: USDG_ADDRESS,
};
