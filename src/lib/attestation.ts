/**
 * ATTESTATION HASHES — the "what was asked for / what was delivered" binding.
 *
 * Both hashes are pure, deterministic functions of data we already store, so the
 * same value is computed on the client (which signs it) and on the server (which
 * records it). They end up in the escrow contract's events, which means the
 * brief the critic scored against is citable on-chain rather than a claim made
 * after the fact.
 *
 * Imported by client components AND API routes — keep it dependency-free
 * (viem only; no node built-ins).
 */

import { keccak256, toBytes, type Hex } from "viem";

/** The subset of a bounty the brief hash commits to. */
export type BriefFields = {
  title?: string | null;
  role?: string | null;
  instructions?: string | null;
  deliverable_specs?: string | null;
  reward_eth?: number | string | null;
};

/**
 * Canonical, order-stable serialization of a brief. Field ORDER is part of the
 * hash, so never reorder these lines — a reordering silently invalidates every
 * previously funded brief.
 */
export function canonicalBriefText(b: BriefFields): string {
  const norm = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  return [
    `title:${norm(b.title)}`,
    `role:${norm(b.role)}`,
    `reward:${norm(b.reward_eth)}`,
    `instructions:${norm(b.instructions)}`,
    `specs:${norm(b.deliverable_specs)}`,
  ].join("\n");
}

/** keccak256 of the canonical brief — the value the escrow locks at fund time. */
export function hashBrief(b: BriefFields): Hex {
  return keccak256(toBytes(canonicalBriefText(b)));
}

/** keccak256 of raw artifact bytes — the delivery attestation. */
export function hashBytes(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

/**
 * keccak256 of the off-chain bounty id: the escrow's mapping key.
 * Must match CreatorFoundryBountyEscrow.keyFor(string) exactly.
 */
export function bountyKey(bountyId: string): Hex {
  return keccak256(toBytes(bountyId));
}

/** Short display form of a hash: 0x1234…cdef. */
export function shortHash(h: string | null | undefined, size = 4): string {
  if (!h) return "—";
  if (h.length <= size * 2 + 2) return h;
  return `${h.slice(0, size + 2)}…${h.slice(-size)}`;
}
