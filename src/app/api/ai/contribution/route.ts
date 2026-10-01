import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";
import { supabase } from "@/lib/supabase";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workId = searchParams.get("workId");
    if (!workId) {
      return NextResponse.json({ error: "workId is required" }, { status: 400 });
    }

    const recommendations = await FoundryOrchestrator.recommendContributionSplit(workId);
    return NextResponse.json({ recommendations });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load contribution splits" }, { status: 500 });
  }
}

// POST: Human edit override -> updates the revenue_percent values on the bounties in the DB
export async function POST(req: NextRequest) {
  try {
    const { workId, splits, wallet } = await req.json(); // splits: Array<{ address: string, percent: number }>
    if (!workId || !Array.isArray(splits)) {
      return NextResponse.json({ error: "workId and splits are required" }, { status: 400 });
    }
    const ownerCheck = await requireWorkOwner(workId, wallet);
    if (ownerCheck) return ownerCheck;

    // Load minted bounties for this work
    const { data: bounties, error: bErr } = await supabase
      .from("bounties")
      .select("*")
      .eq("work_id", workId)
      .eq("status", "minted");

    if (bErr || !bounties) {
      return NextResponse.json({ error: "No minted bounties found for splits" }, { status: 404 });
    }

    // Update each bounty's revenue_percent to match the split for that creator address
    for (const split of splits) {
      // Find the first bounty claimed by this address for this work and assign the percentage
      const matchingBounty = (bounties as any[]).find(
        (b: any) => b.claimed_by && b.claimed_by.toLowerCase() === split.address.toLowerCase()
      );
      if (matchingBounty) {
        await supabase
          .from("bounties")
          .update({ revenue_percent: split.percent })
          .eq("id", matchingBounty.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to save royalty splits" }, { status: 500 });
  }
}
