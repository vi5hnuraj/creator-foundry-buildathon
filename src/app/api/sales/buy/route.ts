import { NextRequest, NextResponse } from "next/server";
import { buyCopy } from "@/lib/services/sales";

// POST /api/sales/buy  { workId, quantity?, txHash? }
// The buyer's wallet signs the USDG payment to the work's splits contract
// (browser-side); the tx hash is recorded here for the storefront ledger.
// Without a txHash (demo mode) the server records a simulated sale.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { workId, quantity, txHash } = body ?? {};
  if (!workId) return NextResponse.json({ error: "workId is required" }, { status: 400 });
  const result = await buyCopy({ workId, quantity, txHash });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
