import { NextRequest, NextResponse } from "next/server";
import { openBounty } from "@/lib/services/works";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function POST(req: NextRequest) {
  try {
    const { workId, bounties, wallet } = await req.json();
    if (!workId || !Array.isArray(bounties)) {
      return NextResponse.json({ error: "workId and bounties are required" }, { status: 400 });
    }
    const ownerCheck = await requireWorkOwner(workId, wallet);
    if (ownerCheck) return ownerCheck;

    const created = [];
    for (const b of bounties) {
      const result = await openBounty({
        workId,
        title: b.title,
        role: b.role,
        rewardEth: Number(b.rewardEth || 0.001),
        revenuePercent: b.revenuePercent != null ? Number(b.revenuePercent) : undefined,
        instructions: b.instructions,
        deliverableSpecs: b.deliverableSpecs,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }
      created.push(result.data);
    }

    return NextResponse.json({ success: true, count: created.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to populate bounties" }, { status: 500 });
  }
}
