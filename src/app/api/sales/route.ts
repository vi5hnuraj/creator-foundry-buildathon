import { NextRequest, NextResponse } from "next/server";
import { listSales } from "@/lib/services/sales";

// GET /api/sales?work=<id> — sales recorded for a work (Mundo A on-chain copies
// + Mundo B bridged externals). Thin wrapper over the listSales service; feeds
// the Store's "Recent sales" list.
export async function GET(req: NextRequest) {
  const work = req.nextUrl.searchParams.get("work");
  if (!work) {
    return NextResponse.json({ error: "work query param is required" }, { status: 400 });
  }

  const result = await listSales(work);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ sales: result.data });
}
