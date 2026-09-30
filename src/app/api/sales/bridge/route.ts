import { NextRequest, NextResponse } from "next/server";
import { bridgeExternalSale } from "@/lib/services/sales";
import { requireWorkOwner } from "@/lib/owner-guard";

// POST /api/sales/bridge
//   { wallet, workId, receiptContract, receiptTokenId, priceEth, principalAddress, participants }
//
// The external event (Steam sale) is simulated by the caller; the on-chain
// split payout is real. This is the same function the MCP agent will call.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    wallet,
    workId,
    receiptContract,
    receiptTokenId,
    priceEth,
    principalAddress,
    participants,
  } = body ?? {};
  const ownerCheck = await requireWorkOwner(workId, wallet);
  if (ownerCheck) return ownerCheck;

  if (!workId || !receiptContract || !receiptTokenId || !priceEth || !principalAddress) {
    return NextResponse.json(
      { error: "workId, receiptContract, receiptTokenId, priceEth, principalAddress are required" },
      { status: 400 }
    );
  }

  const result = await bridgeExternalSale({
    workId,
    receiptContract,
    receiptTokenId,
    priceEth: String(priceEth),
    principalAddress,
    participants: participants ?? [],
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
