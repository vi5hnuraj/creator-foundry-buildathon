import { NextRequest, NextResponse } from "next/server";
import { listOpenBounties, listBountiesByClaimer } from "@/lib/services/bounties";

// GET /api/bounties?work=<id>        — open bounties (optionally scoped to a work)
// GET /api/bounties?claimedBy=<addr> — bounties claimed by a wallet ("my tasks")
export async function GET(req: NextRequest) {
  const work = req.nextUrl.searchParams.get("work") ?? undefined;
  const claimedBy = req.nextUrl.searchParams.get("claimedBy");

  if (claimedBy) {
    const result = await listBountiesByClaimer(claimedBy);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ bounties: result.data });
  }

  const result = await listOpenBounties(work);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ bounties: result.data });
}
