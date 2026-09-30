import { NextRequest, NextResponse } from "next/server";
import { supabase, type Bounty } from "@/lib/supabase";
import { requireWorkOwner } from "@/lib/owner-guard";

/**
 * ESCROW BOOKKEEPING — the off-chain mirror of CreatorFoundryBountyEscrow.
 *
 * POST /api/bounties/:id/escrow
 *   { wallet, action: "fund",    txHash, briefHash, deliveryWindowSeconds, reviewWindowSeconds }
 *   { wallet, action: "assign",  txHash }
 *   { wallet, action: "attest",  txHash, deliveryHash }        // contributor only
 *   { wallet, action: "release", txHash, criticScore, kind }   // kind: "release" | "auto"
 *   { wallet, action: "refund",  txHash }
 *
 * The chain is the source of truth for the money; this route only records which
 * transaction did what, so the UI (and the submission's audit trail) can show
 * the whole lifecycle without re-reading logs. Each action is authorised for
 * exactly the party the contract allows: fund/assign/release/refund belong to
 * the work owner, attest belongs to the contributor, and auto-release is
 * permissionless by design.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const { wallet, action, txHash } = body ?? {};

  const { data, error } = await supabase.from("bounties").select("*").eq("id", params.id).single();
  if (error || !data) return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  const bounty = data as Bounty;

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  if (action === "attest") {
    // Only the wallet that claimed the bounty may attest its own delivery.
    if (!wallet || bounty.claimed_by?.toLowerCase() !== String(wallet).toLowerCase()) {
      return NextResponse.json(
        { error: "Only the contributor who claimed this bounty can attest the delivery." },
        { status: 403 }
      );
    }
    if (txHash) update.attest_tx = txHash;
    if (body?.deliveryHash) update.delivery_hash = body.deliveryHash;
  } else if (action === "auto") {
    // Permissionless: no owner check, this is the SLA backstop firing.
    update.escrow_release_kind = "auto";
    if (txHash) update.escrow_release_tx = txHash;
  } else if (action === "release") {
    const ownerCheck = await requireWorkOwner(bounty.work_id, wallet);
    if (ownerCheck) return ownerCheck;
    update.escrow_release_kind = "release";
    if (txHash) update.escrow_release_tx = txHash;
    if (typeof body?.criticScore === "number") update.escrow_release_score = body.criticScore;
  } else if (action === "refund") {
    const ownerCheck = await requireWorkOwner(bounty.work_id, wallet);
    if (ownerCheck) return ownerCheck;
    update.escrow_release_kind = "refund";
    if (txHash) update.escrow_release_tx = txHash;
    // The reward came back to the producer, so the bounty reopens for someone
    // else rather than sitting in a half-claimed state.
    update.status = "open";
    update.claimed_by = null;
    update.escrow_tx = null;
    update.escrow_funded_at = null;
    update.escrow_assign_tx = null;
    update.delivery_hash = null;
  } else {
    // fund | assign
    const ownerCheck = await requireWorkOwner(bounty.work_id, wallet);
    if (ownerCheck) return ownerCheck;

    if (action === "fund") {
      if (!txHash) return NextResponse.json({ error: "txHash is required" }, { status: 400 });
      update.escrow_tx = txHash;
      update.escrow_funded_at = now;
      if (body?.briefHash) update.brief_hash = body.briefHash;
      if (typeof body?.deliveryWindowSeconds === "number")
        update.delivery_window_seconds = body.deliveryWindowSeconds;
      if (typeof body?.reviewWindowSeconds === "number")
        update.review_window_seconds = body.reviewWindowSeconds;
    } else if (action === "assign") {
      if (!txHash) return NextResponse.json({ error: "txHash is required" }, { status: 400 });
      update.escrow_assign_tx = txHash;
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  }

  const { data: updated, error: updErr } = await supabase
    .from("bounties")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ bounty: updated });
}
