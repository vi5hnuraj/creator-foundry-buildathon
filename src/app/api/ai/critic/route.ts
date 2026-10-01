import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { FoundryOrchestrator } from "@/lib/services/ai";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function POST(req: NextRequest) {
  try {
    const { bountyId, deliveryPath, wallet } = await req.json();
    if (!bountyId) {
      return NextResponse.json({ error: "bountyId is required" }, { status: 400 });
    }

    // 1. Get the bounty's work_id
    const { data: bounty, error: bErr } = await supabase
      .from("bounties")
      .select("work_id")
      .eq("id", bountyId)
      .single();

    if (bErr || !bounty) {
      return NextResponse.json({ error: "Bounty not found" }, { status: 404 });
    }

    const ownerCheck = await requireWorkOwner(bounty.work_id, wallet);
    if (ownerCheck) return ownerCheck;

    // 2. Get the project's Creative Memory
    const memory = await FoundryOrchestrator.getCreativeMemory(bounty.work_id);

    // 3. Run Critic against memory
    const report = await FoundryOrchestrator.runCreativeCritic(bountyId, deliveryPath || "", memory);

    return NextResponse.json({ report });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to run critic" }, { status: 500 });
  }
}
