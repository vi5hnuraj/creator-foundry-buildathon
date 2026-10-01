"use client";

/**
 * USDG payment helpers (Arbitrum Buildathon).
 *
 * Bounties pay contributors in USDG (Paxos Global Dollar) and copy purchases
 * are wallet-signed USDG transfers to the work's CreatorFoundrySplits
 * contract — the split releases pro-rata to every contributor on-chain.
 *
 * Bounty rewards go through CreatorFoundryBountyEscrow when it is deployed:
 * the producer locks the money before the work starts, and the review SLA
 * releases it to the contributor automatically if the producer goes quiet.
 * `payBountyInUsdg` (direct transfer) remains the fallback for deployments with
 * no escrow address configured.
 *
 * These helpers run in the browser via wagmi; amounts are converted to the
 * ERC-20 6-decimal base units Paxos uses across EVM chains.
 */

import {
  USDG_ADDRESS,
  ERC20_ABI,
  BOUNTY_ESCROW_ADDRESS,
  BOUNTY_ESCROW_ABI,
  ESCROW_ENABLED,
} from "./chains";
import { bountyKey } from "./attestation";

export { ESCROW_ENABLED, BOUNTY_ESCROW_ADDRESS };

export const USDG_DECIMALS = 6;

/** Default SLA windows offered by the producer when escrowing a bounty. */
export const DEFAULT_DELIVERY_WINDOW_SECONDS = 7 * 24 * 60 * 60; // 7 days to deliver
/**
 * 72 hours for the producer to review. The contract floor is 5 minutes so the
 * auto-release path can be demonstrated live on testnet; the UI marks that
 * option as a demo window rather than a realistic policy.
 */
export const DEFAULT_REVIEW_WINDOW_SECONDS = 72 * 60 * 60;

export function parseUsdg(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDG_DECIMALS));
}

export function formatUsdg(baseUnits: bigint): string {
  return (Number(baseUnits) / 10 ** USDG_DECIMALS).toFixed(2);
}

/**
 * Coarse, calm SLA countdown: "2d 4h" → "4h 12m" → "3m 08s". Shared by the
 * producer board and the contributor hub so both sides read the same clock.
 */
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "expired";
  const d = Math.floor(secondsLeft / 86400);
  const h = Math.floor((secondsLeft % 86400) / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = Math.floor(secondsLeft % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Seconds remaining until a unix timestamp, floored at 0. */
export function secondsLeftUntil(deadlineUnix: number): number {
  return Math.max(0, Math.floor(deadlineUnix - Date.now() / 1000));
}

type WriteArgs = { address: `0x${string}`; abi: unknown; functionName: string; args?: unknown[] };

/** Minimal wagmi writeContract signature — injected by the caller page. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UsdgWriter = (args: any) => Promise<`0x${string}`>;

/** Pay a bounty: wallet-signed USDG transfer producer → contributor. */
export async function payBountyInUsdg(
  writeContractAsync: UsdgWriter,
  opts: { contributor: string; amount: number }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: USDG_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [opts.contributor, parseUsdg(opts.amount)],
  } as never);
}

/** Buy a copy: wallet-signed USDG transfer buyer → splits contract. */
export async function buyCopyInUsdg(
  writeContractAsync: UsdgWriter,
  opts: { splitsContract: string; amount: number }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: USDG_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [opts.splitsContract, parseUsdg(opts.amount)],
  } as never);
}

/** Commit a split table on the work's CreatorFoundrySplits contract. */
export async function commitSplitOnChain(
  writeContractAsync: UsdgWriter,
  opts: { splitsContract: string; payees: string[]; weights: number[]; feeBps: number }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: opts.splitsContract as `0x${string}`,
    abi: [
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
    ],
    functionName: "commitSplit",
    args: [opts.payees, opts.weights, opts.feeBps],
  } as never);
}

// ---------------------------------------------------------------------------
// Bounty escrow — money locked before the work starts
// ---------------------------------------------------------------------------

/** Reader injected by the caller page (wagmi's usePublicClient().readContract). */
export type EscrowReader = (args: {
  address: `0x${string}`;
  abi: unknown;
  functionName: string;
  args?: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) => Promise<any>;

/** Decoded on-chain escrow state for one bounty. */
export type EscrowState = {
  producer: string;
  contributor: string;
  amount: bigint;
  deliveryDeadline: number; // unix seconds (0 until a contributor is assigned)
  reviewDeadline: number; // unix seconds (0 until a delivery is attested)
  attested: boolean;
  released: boolean;
  /** The producer reclaimed the reward; the bounty reopened for a new round. */
  refunded: boolean;
  criticScore: number;
  releasable: boolean; // the contributor can pull the money themselves
};

/** Throws a clear error instead of signing to 0x0 when escrow isn't deployed. */
function escrowAddress(): `0x${string}` {
  if (!ESCROW_ENABLED || !BOUNTY_ESCROW_ADDRESS) {
    throw new Error(
      "Bounty escrow contract is not configured. Run `npm run deploy` to deploy it (NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS)."
    );
  }
  return BOUNTY_ESCROW_ADDRESS;
}

/** Read the full escrow state for a bounty (null when it was never funded). */
export async function readBountyEscrow(
  readContract: EscrowReader,
  bountyId: string
): Promise<EscrowState | null> {
  if (!ESCROW_ENABLED) return null;
  try {
    const [state, releasable] = await Promise.all([
      readContract({
        address: escrowAddress(),
        abi: BOUNTY_ESCROW_ABI,
        functionName: "escrows",
        args: [bountyKey(bountyId)],
      }),
      readContract({
        address: escrowAddress(),
        abi: BOUNTY_ESCROW_ABI,
        functionName: "releasable",
        args: [bountyKey(bountyId)],
      }),
    ]);
    // The auto-generated getter returns a positional tuple — the order mirrors
    // the contract's Escrow struct exactly.
    const [
      producer,
      contributor,
      amount,
      ,
      deliveryDeadline,
      reviewDeadline,
      attested,
      released,
      refunded,
      ,
      ,
      criticScore,
    ] = state as readonly [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      boolean,
      boolean,
      boolean,
      string,
      string,
      number,
    ];
    return {
      producer,
      contributor,
      amount,
      deliveryDeadline: Number(deliveryDeadline),
      reviewDeadline: Number(reviewDeadline),
      attested,
      released,
      refunded,
      criticScore: Number(criticScore),
      releasable: Boolean(releasable),
    };
  } catch (e) {
    console.warn("[escrow] read failed:", e);
    return null;
  }
}

/** Approve the escrow to pull `amount` USDG from the connected wallet. */
export async function approveUsdg(
  writeContractAsync: UsdgWriter,
  opts: { spender: string; amount: number }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: USDG_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [opts.spender, parseUsdg(opts.amount)],
  } as never);
}

/**
 * Lock a bounty reward in escrow.
 *
 * Approves the escrow for the exact amount first, but only when the existing
 * allowance is insufficient — so re-funding another bounty on the same page
 * doesn't cost the producer a redundant signature.
 */
export async function fundBountyEscrow(
  writeContractAsync: UsdgWriter,
  readContract: EscrowReader,
  opts: {
    bountyId: string;
    amount: number;
    briefHash: `0x${string}`;
    owner: string;
    /** Live progress for UI checklists: fires right before each wallet prompt. */
    onStep?: (step: "approve" | "fund") => void;
  }
): Promise<{ approveTx?: `0x${string}`; fundTx: `0x${string}` }> {
  const spender = escrowAddress();
  const needed = parseUsdg(opts.amount);

  let approveTx: `0x${string}` | undefined;
  let existing = 0n;
  try {
    existing = (await readContract({
      address: USDG_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [opts.owner, spender],
    })) as bigint;
  } catch {
    existing = 0n; // unknown allowance → just ask for approval
  }

  if (existing < needed) {
    opts.onStep?.("approve");
    approveTx = await approveUsdg(writeContractAsync, { spender, amount: opts.amount });
  }

  opts.onStep?.("fund");
  const fundTx = await writeContractAsync({
    address: spender,
    abi: BOUNTY_ESCROW_ABI,
    functionName: "fund",
    args: [bountyKey(opts.bountyId), needed, opts.briefHash],
  } as never);

  return { approveTx, fundTx };
}

/** Producer names the contributor and starts both SLA clocks. */
export async function assignBountyContributor(
  writeContractAsync: UsdgWriter,
  opts: {
    bountyId: string;
    contributor: string;
    deliveryWindowSeconds: number;
    reviewWindowSeconds: number;
  }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: escrowAddress(),
    abi: BOUNTY_ESCROW_ABI,
    functionName: "assignContributor",
    args: [
      bountyKey(opts.bountyId),
      opts.contributor,
      BigInt(opts.deliveryWindowSeconds),
      BigInt(opts.reviewWindowSeconds),
    ],
  } as never);
}

/** Contributor attestation: "this hash is what I delivered" — starts the review clock. */
export async function attestBountyDelivery(
  writeContractAsync: UsdgWriter,
  opts: { bountyId: string; deliveryHash: `0x${string}` }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: escrowAddress(),
    abi: BOUNTY_ESCROW_ABI,
    functionName: "attestDelivery",
    args: [bountyKey(opts.bountyId), opts.deliveryHash],
  } as never);
}

/** Producer releases the escrow to the contributor, stamping the critic score. */
export async function releaseBountyEscrow(
  writeContractAsync: UsdgWriter,
  opts: { bountyId: string; criticScore: number }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: escrowAddress(),
    abi: BOUNTY_ESCROW_ABI,
    functionName: "release",
    args: [bountyKey(opts.bountyId), Math.max(0, Math.min(100, Math.round(opts.criticScore)))],
  } as never);
}

/**
 * SLA backstop, callable by ANYONE once the review window has closed. This is
 * the contributor's recourse if the producer never reviews — they can pull
 * their own payment without the producer's signature.
 */
export async function autoReleaseBountyEscrow(
  writeContractAsync: UsdgWriter,
  opts: { bountyId: string }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: escrowAddress(),
    abi: BOUNTY_ESCROW_ABI,
    functionName: "autoRelease",
    args: [bountyKey(opts.bountyId)],
  } as never);
}

/** Producer reclaims the reward when nothing was ever delivered. */
export async function refundBountyEscrow(
  writeContractAsync: UsdgWriter,
  opts: { bountyId: string }
): Promise<`0x${string}`> {
  return writeContractAsync({
    address: escrowAddress(),
    abi: BOUNTY_ESCROW_ABI,
    functionName: "refund",
    args: [bountyKey(opts.bountyId)],
  } as never);
}
