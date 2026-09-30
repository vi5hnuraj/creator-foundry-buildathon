import { NextRequest, NextResponse } from "next/server";
import { claimBounty } from "@/lib/services/bounties";

// POST /api/bounties/:id/claim  { wallet, kind? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { wallet, kind } = body ?? {};
  if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  const result = await claimBounty({ bountyId: params.id, wallet, kind });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ bounty: result.data });
}
