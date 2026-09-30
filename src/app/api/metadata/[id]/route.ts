import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type CriticFeedback = {
  score?: number;
  recommendation?: string;
  model?: string;
  styleScore?: number;
  paletteMatch?: number;
  qualityScore?: number;
};

/**
 * ATTESTATION IN THE TOKEN METADATA.
 *
 * The NFT's `uri` points back at this endpoint, so the brief hash, the delivery
 * hash and the escrow release are readable from the token forever. That makes
 * the critic's score citable: anyone can recompute the delivery hash from the
 * artifact and confirm it is the exact file that was scored and paid for — the
 * "what was asked for" and "what was paid for" are bound together on-chain.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { data, error } = await supabase
    .from("bounties")
    .select(
      "id, title, role, work_id, delivery_ipfs, delivery_path, status, claimed_by, critic_feedback, brief_hash, delivery_hash, escrow_tx, escrow_release_tx, escrow_release_kind"
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const baseUrl = _req.nextUrl.origin;
  const imageUrl = data.delivery_ipfs
    ? `${baseUrl}/api/files/${data.delivery_path || data.delivery_ipfs}`
    : `${baseUrl}/og-image.png`;

  // On-chain AI verdict: the trained critic's scores are embedded as NFT
  // attributes so the review is verifiable in the token metadata forever.
  const critic = (data.critic_feedback ?? null) as CriticFeedback | null;
  const escrowAddress = process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS ?? null;

  return NextResponse.json({
    name: data.title,
    description: `Creator Foundry deliverable — ${data.role} role for project ${data.work_id}`,
    image: imageUrl,
    external_url: `${baseUrl}/work/${data.work_id}`,
    attributes: [
      { trait_type: "Role", value: data.role },
      { trait_type: "Status", value: data.status },
      ...(critic
        ? [
            ...(critic.model ? [{ trait_type: "CriticModel", value: critic.model }] : []),
            ...(typeof critic.styleScore === "number"
              ? [{ trait_type: "CriticStyle", value: critic.styleScore }]
              : []),
            ...(typeof critic.paletteMatch === "number"
              ? [{ trait_type: "CriticPalette", value: critic.paletteMatch }]
              : []),
            ...(typeof critic.qualityScore === "number"
              ? [{ trait_type: "CriticQuality", value: critic.qualityScore }]
              : []),
            ...(typeof critic.score === "number"
              ? [{ trait_type: "CriticScore", value: critic.score }]
              : []),
          ]
        : []),
      // --- Escrow attestation ---------------------------------------------
      ...(data.brief_hash ? [{ trait_type: "BriefHash", value: data.brief_hash }] : []),
      ...(data.delivery_hash
        ? [{ trait_type: "DeliveryHash", value: data.delivery_hash }]
        : []),
      ...(data.escrow_tx ? [{ trait_type: "EscrowFundingTx", value: data.escrow_tx }] : []),
      ...(data.escrow_release_tx
        ? [{ trait_type: "EscrowReleaseTx", value: data.escrow_release_tx }]
        : []),
      ...(data.escrow_release_kind
        ? [{ trait_type: "EscrowReleaseKind", value: data.escrow_release_kind }]
        : []),
      ...(escrowAddress ? [{ trait_type: "EscrowContract", value: escrowAddress }] : []),
    ],
  });
}
