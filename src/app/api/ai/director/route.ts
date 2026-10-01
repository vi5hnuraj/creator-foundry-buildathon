import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function POST(req: NextRequest) {
  try {
    const { idea, workId, wallet, conversationContext } = await req.json();
    if (!idea) {
      return NextResponse.json({ error: "idea is required" }, { status: 400 });
    }
    if (workId && wallet) {
      const ownerCheck = await requireWorkOwner(workId, wallet);
      if (ownerCheck) return ownerCheck;
    }

    const plan = await FoundryOrchestrator.generateProductionPlan(
      idea,
      typeof conversationContext === "string" ? conversationContext.slice(-6000) : undefined
    );
    return NextResponse.json({ plan });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to generate plan" }, { status: 500 });
  }
}
