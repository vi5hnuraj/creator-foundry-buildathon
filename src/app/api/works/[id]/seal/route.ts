import { NextRequest, NextResponse } from "next/server";
import { sealWork, sealWorkWallet } from "@/lib/services/works";
import { requireWorkOwner } from "@/lib/owner-guard";
import { resolveWorkParam } from "@/lib/slug-server";

// POST /api/works/:id/seal — deploy lazy collection, prepare, configure release
// If txHash is provided, the wallet already signed the mint — just record metadata
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { basePriceEth, feeMode, imagePath, wallet, txHash, splitsTxHash } = body ?? {};
  if (basePriceEth == null || !feeMode || !imagePath) {
    return NextResponse.json(
      { error: "basePriceEth, feeMode, imagePath are required" },
      { status: 400 }
    );
  }
  // Canonicalize slug → UUID before any write.
  const resolved = await resolveWorkParam(params.id);
  if (!resolved) return NextResponse.json({ error: "Work not found" }, { status: 404 });
  const ownerCheck = await requireWorkOwner(resolved.id, wallet);
  if (ownerCheck) return ownerCheck;

  // Wallet-signed path — just record metadata in DB
  if (txHash) {
    const result = await sealWorkWallet({
      workId: resolved.id,
      basePriceEth: Number(basePriceEth),
      feeMode,
      imagePath,
      txHash,
      splitsTxHash,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json(result.data);
  }

  const result = await sealWork({
    workId: resolved.id,
    basePriceEth: Number(basePriceEth),
    feeMode,
    imagePath,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json(result.data);
}
