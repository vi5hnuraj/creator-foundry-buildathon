import { NextRequest, NextResponse } from "next/server";
import { deliverBounty } from "@/lib/services/bounties";

// POST /api/bounties/:id/deliver  { wallet, deliveryPath, deliveryIpfs? }
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { wallet, deliveryPath, deliveryIpfs } = body ?? {};
  if (!wallet || !deliveryPath) {
    return NextResponse.json({ error: "wallet and deliveryPath are required" }, { status: 400 });
  }
  const result = await deliverBounty({
    bountyId: params.id,
    wallet,
    deliveryPath,
    deliveryIpfs,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ bounty: result.data });
}
