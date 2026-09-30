import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { supabase, type Bounty } from "@/lib/supabase";
import { hashBrief, hashBytes } from "@/lib/attestation";
import { downloadToTemp, removeTemp } from "@/lib/storage";

/**
 * ATTESTATION HASHES for a bounty.
 *
 * GET /api/bounties/:id/attest
 *   -> { briefHash, deliveryHash, hasDelivery }
 *
 * The brief hash is what the producer locks in escrow when funding (it commits
 * to the instructions the money is buying). The delivery hash is what the
 * contributor attests on-chain after delivering (keccak256 of the actual
 * artifact bytes, not of its filename — a renamed file can't fake it).
 *
 * Hashes are not secret, so this is a plain GET: both sides read the same
 * values and the same values are what the UI passes to the contract.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase.from("bounties").select("*").eq("id", params.id).single();
  if (error || !data) return NextResponse.json({ error: "Bounty not found" }, { status: 404 });

  const bounty = data as Bounty;
  const briefHash = bounty.brief_hash || hashBrief(bounty);

  // Cache the brief hash on first read so the value the contributor signs
  // against is the one the producer already funded.
  if (!bounty.brief_hash) {
    await supabase.from("bounties").update({ brief_hash: briefHash }).eq("id", params.id);
  }

  let deliveryHash = bounty.delivery_hash || null;
  const hasDelivery = !!bounty.delivery_path;

  // Hash the delivered artifact bytes if we have them and haven't yet.
  if (hasDelivery && !deliveryHash && bounty.delivery_path) {
    let tempPath: string | null = null;
    try {
      tempPath = await downloadToTemp(bounty.delivery_path);
      const bytes = await readFile(tempPath);
      deliveryHash = hashBytes(bytes);
      await supabase.from("bounties").update({ delivery_hash: deliveryHash }).eq("id", params.id);
    } catch (e) {
      // Non-fatal: the UI simply offers the action without a precomputed hash.
      console.warn("[attest] could not hash delivery:", e);
      deliveryHash = null;
    } finally {
      await removeTemp(tempPath);
    }
  }

  return NextResponse.json({ briefHash, deliveryHash, hasDelivery });
}
