import { NextRequest, NextResponse } from "next/server";
import { resolveWorkParam } from "@/lib/slug-server";
import { supabase, type Bounty, type Work } from "@/lib/supabase";
import { buildRevenueSplit, toSplitWeights, PLATFORM_FEE_WALLET } from "@/lib/asset-forge";
import { SPLITS_CONTRACT_ADDRESS } from "@/lib/chains";

/**
 * THE EXACT ON-CHAIN SPLIT TABLE for a work.
 *
 * GET /api/works/:id/split
 *   -> { payees, weights, feeBps, breakdown, feeWallet, splitsContract }
 *
 * `commitSplit` needs integer weights summing to exactly 10_000 with NO duplicate
 * payees. The producer's wallet has to sign it (the contract's controller is the
 * producer's address), but the arithmetic must come from ONE source of truth:
 * buildRevenueSplit. Recomputing it in the browser is how you end up with a table
 * the contract rejects — in particular, the fee wallet is often also the
 * principal, and those two rows have to be consolidated into one payee.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // Slug or UUID both resolve here.
  const resolved = await resolveWorkParam(params.id);
  if (!resolved) return NextResponse.json({ error: "Work not found" }, { status: 404 });
  const workId = resolved.id;

  const { data: work, error } = await supabase.from("works").select("*").eq("id", workId).single();
  if (error || !work) return NextResponse.json({ error: "Work not found" }, { status: 404 });

  const { data: bounties, error: bErr } = await supabase
    .from("bounties")
    .select("*")
    .eq("work_id", workId)
    .eq("status", "minted");
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  // Only minted contributions with a granted share are payees — the on-chain
  // table must describe assets that actually exist.
  const participants = (bounties as Bounty[])
    .filter((b) => b.claimed_by && b.revenue_percent != null && b.revenue_percent > 0)
    .map((b) => ({ address: b.claimed_by as string, role: b.role, percent: b.revenue_percent as number }));

  let split;
  try {
    split = buildRevenueSplit({
      principalAddress: (work as Work).requester_addr,
      participants,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not build the split table" },
      { status: 409 }
    );
  }

  const { payees, weights, feeBps } = toSplitWeights(split.splits);

  return NextResponse.json({
    payees,
    weights,
    feeBps,
    breakdown: split.breakdown,
    totalWeight: weights.reduce((s, w) => s + w, 0),
    feeWallet: PLATFORM_FEE_WALLET,
    splitsContract: SPLITS_CONTRACT_ADDRESS,
  });
}
