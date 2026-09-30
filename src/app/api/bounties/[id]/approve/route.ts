import { NextRequest, NextResponse } from "next/server";
import { approveAndMint, requestChanges } from "@/lib/services/bounties";
import { supabase } from "@/lib/supabase";
import { requireWorkOwner } from "@/lib/owner-guard";

async function verifyBountyOwner(bountyId: string, wallet: string | undefined | null) {
  const { data: bounty, error } = await supabase
    .from("bounties")
    .select("work_id")
    .eq("id", bountyId)
    .single();
  if (error || !bounty) {
    return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
  }
  return requireWorkOwner(bounty.work_id, wallet);
}

// POST /api/bounties/:id/approve
//   { wallet, assetContract }            -> approve + mint on-chain
//   { wallet, action: "request_changes" } -> bounce back to claimed
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const ownerCheck = await verifyBountyOwner(params.id, body?.wallet);
  if (ownerCheck) return ownerCheck;

  if (body?.action === "request_changes") {
    const result = await requestChanges(params.id, body?.revision);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ bounty: result.data });
  }

  const { assetContract, txHash, tokenId } = body ?? {};

  // Payment/attestation hashes travel with the same approval. The mint is the
  // authorship proof and the escrow release is the money — both have to land in
  // the same record or the audit trail has a hole.
  const extras: Record<string, unknown> = {};
  // A wallet-signed mint is real by definition — record it as such so the UI
  // never labels it a local/simulated record.
  if (txHash) extras.mint_mode = "onchain";
  if (body?.paymentTxHash) extras.payment_tx_hash = body.paymentTxHash;
  if (body?.escrowReleaseTx) extras.escrow_release_tx = body.escrowReleaseTx;
  if (body?.escrowReleaseKind) extras.escrow_release_kind = body.escrowReleaseKind;
  if (body?.escrowReleaseScore != null) extras.escrow_release_score = body.escrowReleaseScore;
  if (body?.briefHash) extras.brief_hash = body.briefHash;
  if (body?.deliveryHash) extras.delivery_hash = body.deliveryHash;
  const hasExtras = Object.keys(extras).length > 0;

  // If the wallet already signed the mint transaction, just record on-chain data
  if (txHash) {
    const result = await approveAndMint({
      bountyId: params.id,
      assetContract: assetContract || "deferred",
      txHash,
      tokenId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    if (hasExtras) await supabase.from("bounties").update(extras).eq("id", params.id);
    return NextResponse.json({ bounty: { ...result.data, ...extras } });
  }

  const result = await approveAndMint({ bountyId: params.id, assetContract: assetContract || "deferred" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  if (hasExtras) await supabase.from("bounties").update(extras).eq("id", params.id);
  return NextResponse.json({ bounty: { ...result.data, ...extras } });
}
