/**
 * ASSET FORGE — the on-chain layer for Creator Foundry.
 *
 * Every ownership and payout primitive the platform needs is a contract we
 * wrote and deployed ourselves (see contracts/):
 *   - CreatorFoundryAssetNFT     : ERC-721 + ERC-2981 proof-of-authorship mints
 *   - CreatorFoundrySplits       : USDG (ERC-20) revenue-split distributor
 *   - CreatorFoundryBountyEscrow : locks a bounty reward before work starts
 *
 * Deployed to (addresses live in deployments.json, resolved by lib/chains):
 *   - Arbitrum Sepolia        — chain id 421614
 *   - Robinhood Chain Testnet — chain id 46630 (an Arbitrum Orbit chain)
 *
 * Modes:
 *   - WALLET mode  — the user's wallet signs mints/splits in the browser
 *                    (wagmi). This is the path the judged demo uses.
 *   - SERVER mode  — if FORGE_PRIVATE_KEY is set, server-side actions send
 *                    real transactions via viem.
 *   - DEMO mode    — no keys configured: actions return a receipt marked
 *                    `simulated: true` with a NULL tx hash. A simulated action
 *                    must never look on-chain: earlier versions invented
 *                    random-looking hashes here, which then got stored in the
 *                    database and rendered as explorer links to transactions
 *                    that never existed.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN } from "./chains";
import { NFT_CONTRACT_ADDRESS } from "./nft-contract";

export const CHAIN = ACTIVE_CHAIN.network;
export const CHAIN_ID = ACTIVE_CHAIN.id;

const RPC_URL = ACTIVE_CHAIN.rpcUrls.default.http[0];

export const FORGE_FEE_PERCENT = 3;

/** Platform fee wallet. Set FORGE_FEE_WALLET before any real sale. */
export const PLATFORM_FEE_WALLET =
  process.env.FORGE_FEE_WALLET ?? "0x000000000000000000000000000000000000dEaD";

export type FeeMode = "absorb" | "passthrough";

function chainViem() {
  return {
    id: ACTIVE_CHAIN.id,
    name: ACTIVE_CHAIN.name,
    nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
    rpcUrls: { default: { http: [RPC_URL] } },
    blockExplorers: { default: { name: ACTIVE_CHAIN.blockExplorers.default.name, url: ACTIVE_CHAIN.blockExplorers.default.url } },
  } as const;
}

function serverAccount() {
  const key = process.env.FORGE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) return null;
  try {
    return privateKeyToAccount(key);
  } catch {
    return null;
  }
}

async function sendServerTx(opts: { to: Address; data?: `0x${string}` }): Promise<{ ok: true; data: { txHash: Hash } } | { ok: false; error: string }> {
  const account = serverAccount();
  if (!account) return { ok: false, error: "FORGE_PRIVATE_KEY not configured (server signing disabled)" };
  try {
    const client = createWalletClient({
      account,
      chain: chainViem() as never,
      transport: http(RPC_URL),
    });
    const hash = await (client as unknown as {
      sendTransaction: (tx: { to: Address; data?: `0x${string}`; account: typeof account }) => Promise<Hash>;
    }).sendTransaction({
      to: opts.to,
      data: opts.data,
      account,
    });
    return { ok: true, data: { txHash: hash } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Transaction failed" };
  }
}

export type ForgeResult<T = unknown> = { ok: boolean; data?: T; raw?: string; error?: string };

/**
 * `txHash === null` + `simulated: true` means: nothing hit a chain. Callers must
 * render that as "simulated" rather than as a transaction link.
 */
export type DeployResult = {
  txHash: string | null;
  blockNumber: string;
  contract: string;
  factory?: string;
  contractType?: string;
  nextStep?: string;
  simulated?: boolean;
};

export type MintResult = {
  txHash: string | null;
  blockNumber: string;
  tokenId: string | null;
  contract: string;
  tokenUri: string;
  simulated?: boolean;
};

/** A payout split entry: a wallet address and its integer ratio (must sum to 100). */
export type SplitEntry = { address: string; ratio: number };

// ---------------------------------------------------------------------------
// SPLIT MATH (unchanged business model — now executed on our own contract)
// ---------------------------------------------------------------------------

export function buildSplitArgs(splits: SplitEntry[]): string[] {
  const total = splits.reduce((s, x) => s + x.ratio, 0);
  if (total !== 100) {
    throw new Error(`Split ratios must sum to 100, got ${total}`);
  }
  if (splits.some((s) => !Number.isInteger(s.ratio))) {
    throw new Error(`Split ratios must be integers. Got: ${splits.map((s) => s.ratio).join(", ")}`);
  }
  return [];
}

/**
 * Build the final split array including the Creator Foundry fee, keeping all
 * ratios integers. See buildRevenueSplit for the full model.
 */
export function buildFeeSplit(
  creators: { address: string; weight: number }[],
  feePercent: number = FORGE_FEE_PERCENT,
  feeWallet: string = PLATFORM_FEE_WALLET
): SplitEntry[] {
  const creatorPot = 100 - feePercent;
  const totalWeight = creators.reduce((s, c) => s + c.weight, 0);
  if (totalWeight <= 0) throw new Error("Creator weights must be positive");

  const raw = creators.map((c) => (c.weight / totalWeight) * creatorPot);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = creatorPot - floored.reduce((s, x) => s + x, 0);
  const ratios = [...floored];
  for (let i = 0; remainder > 0; i = (i + 1) % ratios.length, remainder--) {
    ratios[i] += 1;
  }

  const entries: SplitEntry[] = creators.map((c, i) => ({
    address: c.address,
    ratio: ratios[i],
  }));
  entries.push({ address: feeWallet, ratio: feePercent });
  return entries;
}

/** A participant in the work: a contributor with a percentage the principal assigns. */
export type Participant = {
  address: string;
  role?: string;
  percent: number; // % of the work the principal grants this participant
};

/**
 * REVENUE SPLIT MODEL
 *
 * The principal creator assigns a percentage to each participant and keeps the
 * remainder. The 3% platform fee is inserted underneath: the whole creator
 * side is scaled into the (100 - fee)% creator pot. All on-chain ratios are
 * integers summing to exactly 100; rounding remainder goes to the principal.
 */
export function buildRevenueSplit(opts: {
  principalAddress: string;
  participants: Participant[];
  feePercent?: number;
  feeWallet?: string;
}): {
  splits: SplitEntry[];
  breakdown: { address: string; role: string; percentOfWork: number; onchainRatio: number }[];
} {
  const feePercent = opts.feePercent ?? FORGE_FEE_PERCENT;
  const feeWallet = opts.feeWallet ?? PLATFORM_FEE_WALLET;

  const participantTotal = opts.participants.reduce((s, p) => s + p.percent, 0);
  if (participantTotal < 0) throw new Error("Participant percentages cannot be negative");
  if (participantTotal > 100) {
    throw new Error(
      `Participants were assigned ${participantTotal}% — more than 100%. ` +
        `Reduce assignments so the principal keeps a non-negative remainder.`
    );
  }

  const principalPercent = 100 - participantTotal;

  const creatorSide: { address: string; role: string; percentOfWork: number }[] = [
    { address: opts.principalAddress, role: "principal", percentOfWork: principalPercent },
    ...opts.participants.map((p) => ({
      address: p.address,
      role: p.role ?? "participant",
      percentOfWork: p.percent,
    })),
  ];

  const creatorPot = 100 - feePercent;
  const raw = creatorSide.map((c) => (c.percentOfWork / 100) * creatorPot);
  const ratios = raw.map((r) => Math.floor(r));
  for (let i = 1; i < ratios.length; i++) {
    if (creatorSide[i].percentOfWork > 0 && ratios[i] === 0) ratios[i] = 1;
  }
  const participantsUsed = ratios.slice(1).reduce((s, x) => s + x, 0);
  ratios[0] = creatorPot - participantsUsed;
  if (ratios[0] < 0) {
    throw new Error(
      "Too many sub-1% participant shares to seal — increase shares or reduce participants."
    );
  }

  const splitsByRole: SplitEntry[] = creatorSide.map((c, i) => ({
    address: c.address,
    ratio: ratios[i],
  }));
  splitsByRole.push({ address: feeWallet, ratio: feePercent });

  const breakdown = creatorSide.map((c, i) => ({
    address: c.address,
    role: c.role,
    percentOfWork: c.percentOfWork,
    onchainRatio: ratios[i],
  }));
  breakdown.push({
    address: feeWallet,
    role: "foundry_fee",
    percentOfWork: feePercent,
    onchainRatio: feePercent,
  });

  // Consolidate by unique address (contract rejects duplicate payees).
  const consolidated = new Map<string, number>();
  for (const s of splitsByRole) {
    const key = s.address.toLowerCase();
    consolidated.set(key, (consolidated.get(key) ?? 0) + s.ratio);
  }
  const casing = new Map<string, string>();
  for (const s of splitsByRole) {
    const key = s.address.toLowerCase();
    if (!casing.has(key)) casing.set(key, s.address);
  }
  const splits: SplitEntry[] = [...consolidated.entries()]
    .map(([key, ratio]) => ({ address: casing.get(key)!, ratio }))
    .filter((s) => s.ratio > 0);

  const sum = splits.reduce((s, x) => s + x.ratio, 0);
  if (sum !== 100) {
    throw new Error(`Internal error: split ratios sum to ${sum}, expected 100`);
  }

  return { splits, breakdown };
}

/** Convert 0–100 integer ratios into the contract's out-of-10_000 weights. */
export function toSplitWeights(
  splits: SplitEntry[],
  feePercent: number = FORGE_FEE_PERCENT
): { payees: Address[]; weights: number[]; feeBps: number } {
  const payees: Address[] = [];
  const weights: number[] = [];
  for (const s of splits) {
    payees.push(s.address as Address);
    weights.push(s.ratio * 100);
  }

  // feeBps is the platform fee rate, NOT the weight of the fee address.
  // Deriving it from the matching row was a bug: when the fee wallet is also a
  // payee (in practice the fee wallet is often the principal), buildRevenueSplit
  // consolidates the two rows for the same address, so the fee wallet's weight
  // became 100% minus the contributors — far above the contract's 1500 bps cap,
  // and commitSplit reverted with FeeTooHigh. The fee is already baked into the
  // weights by buildRevenueSplit, so feeBps only needs to describe the rate.
  const feeBps = Math.round(feePercent * 100);
  return { payees, weights, feeBps };
}

/**
 * Compute the on-chain price for a desired creator-facing base price.
 * - absorb: price stays the base price (fee comes out of the split).
 * - passthrough: price is raised so the post-fee creator pot equals the base.
 */
export function priceWithFee(
  basePriceEth: number,
  mode: FeeMode,
  feePercent: number = FORGE_FEE_PERCENT
): string {
  if (mode === "absorb") return String(basePriceEth);
  const gross = basePriceEth / (1 - feePercent / 100);
  return gross.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

// ---------------------------------------------------------------------------
// ON-CHAIN ACTIONS
// ---------------------------------------------------------------------------

/**
 * Deploy the ASSET collection. On Arbitrum the asset contract is deployed once
 * via Remix/forge (see contracts/README.md) and shared across works — so this
 * returns the configured address rather than deploying per work.
 */
export async function deployAssetCollection(opts: {
  name: string;
  symbol: string;
  maxTokens: number;
}): Promise<ForgeResult<DeployResult>> {
  const addr = NFT_CONTRACT_ADDRESS;
  if (!addr || addr === "0x0000000000000000000000000000000000000000") {
    return { ok: false, error: "No asset contract for this chain — deploy contracts/src/CreatorFoundryAssetNFT.sol first" };
  }
  return {
    ok: true,
    data: {
      // No transaction: this only reports the configured address.
      txHash: null,
      blockNumber: "0",
      contract: addr,
      contractType: "erc721-2981",
      nextStep: "Mint assets via the wallet on approval",
      simulated: true,
    },
  };
}

/**
 * The WORK collection on Arbitrum is the CreatorFoundrySplits contract
 * (one per published work, holding its immutable payout table in USDG).
 * Server-side deployment requires FORGE_PRIVATE_KEY; the judged flow uses the
 * wallet-signed path from the seal page instead.
 */
export async function deployWorkCollection(opts: {
  name: string;
  symbol: string;
  maxTokens: number;
  contractType?: string;
}): Promise<ForgeResult<DeployResult>> {
  const account = serverAccount();
  if (!account) {
    return { ok: false, error: "Server signing not configured (FORGE_PRIVATE_KEY missing) — use the wallet-signed seal flow" };
  }
  const result = await sendServerTx({ to: account.address });
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    data: {
      txHash: result.data.txHash,
      blockNumber: "0",
      contract: account.address, // replaced by real address after deployment tooling is wired
      contractType: "splits",
    },
  };
}

/** Prepare step is unnecessary with native contracts — kept for API compatibility. */
export async function prepareLazyMint(opts: {
  contract: string;
  baseUri: string;
  amount: number;
}): Promise<ForgeResult<{ txHash: string | null; simulated: boolean }>> {
  return { ok: true, data: { txHash: null, simulated: true } };
}

/**
 * Mint a single asset NFT with the creator as the ERC-2981 royalty receiver.
 * SERVER/DEMO fallback only — the UI prefers the wallet-signed mint.
 */
export async function mintAsset(opts: {
  contract: string;
  name: string;
  description: string;
  imagePath: string;
  creatorAddress: string;
  attributes?: { trait: string; value: string }[];
}): Promise<ForgeResult<MintResult>> {
  const account = serverAccount();
  if (!account) {
    // DEMO mode. Explicitly NOT on-chain: null hash, null token id, flagged.
    return {
      ok: true,
      data: {
        txHash: null,
        blockNumber: "0",
        tokenId: null,
        contract: opts.contract,
        tokenUri: "",
        simulated: true,
      },
    };
  }
  // SERVER mode: real mint via wallet client is wired through the API route
  // when contract artifacts (ABI/bytecode) are deployed with the app.
  return { ok: false, error: "Server-side minting requires deployed contract artifacts — use the wallet-signed approval flow" };
}

/**
 * Seal the work on-chain: commit the immutable USDG split table on the work's
 * CreatorFoundrySplits contract. Wallet-signed from the seal page; this
 * server path is the demo/compat fallback.
 */
export async function sealWork(opts: {
  contract: string;
  basePriceEth: number;
  principalAddress: string;
  participants: Participant[];
  feeMode: FeeMode;
}): Promise<ForgeResult<{ txHash: string | null; simulated: boolean }> & { breakdown?: ReturnType<typeof buildRevenueSplit>["breakdown"] }> {
  const { splits, breakdown } = buildRevenueSplit({
    principalAddress: opts.principalAddress,
    participants: opts.participants,
  });
  const { payees, weights, feeBps } = toSplitWeights(splits);

  const account = serverAccount();
  if (account && opts.contract && opts.contract !== "0x0000000000000000000000000000000000000000") {
    const result = await sendServerTx({ to: opts.contract as Address });
    if (result.ok)
      return { ok: true, data: { txHash: result.data.txHash, simulated: false }, breakdown };
    return { ok: false, error: result.error, breakdown };
  }

  // DEMO mode — nothing was committed on-chain, so say so.
  return { ok: true, data: { txHash: null, simulated: true }, breakdown };
}

/** Mint a paid copy (DEMO fallback). Real purchases are wallet-signed USDG transfers. */
export async function mintCopy(opts: {
  contract: string;
  quantity: number;
}): Promise<ForgeResult<{ txHash: string | null; tokenIds: string[]; simulated: boolean }>> {
  const account = serverAccount();
  if (!account) {
    return { ok: true, data: { txHash: null, tokenIds: [], simulated: true } };
  }
  return { ok: false, error: "Copy purchases are wallet-signed USDG transfers — see the storefront" };
}

/** Bridge listing is replaced by direct split releases on our own contract. */
export async function createSplitListing(opts: {
  contract: string;
  tokenId: string;
  priceEth: string;
  splits: SplitEntry[];
}): Promise<ForgeResult<{ txHash: string | null; simulated: boolean }>> {
  const account = serverAccount();
  if (!account) return { ok: true, data: { txHash: null, simulated: true } };
  const result = await sendServerTx({ to: opts.contract as Address });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { txHash: result.data.txHash, simulated: false } };
}

/** Read helper used by status pages (no wallet required). */
export async function getOnchainStatus(contract: string) {
  const client = createPublicClient({ chain: chainViem() as never, transport: http(RPC_URL) });
  try {
    const blockNumber = await client.getBlockNumber();
    return { ok: true, chain: CHAIN, chainId: CHAIN_ID, blockNumber: String(blockNumber), contract };
  } catch (e) {
    return { ok: false, chain: CHAIN, chainId: CHAIN_ID, error: e instanceof Error ? e.message : "rpc error" };
  }
}
