import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workId = searchParams.get("workId");
    if (!workId) {
      return NextResponse.json({ error: "workId is required" }, { status: 400 });
    }

    const memory = await FoundryOrchestrator.getCreativeMemory(workId);
    return NextResponse.json({ memory });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load memory" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { workId, memory, wallet } = await req.json();
    if (!workId || !memory) {
      return NextResponse.json({ error: "workId and memory are required" }, { status: 400 });
    }
    const ownerCheck = await requireWorkOwner(workId, wallet);
    if (ownerCheck) return ownerCheck;

    const success = await FoundryOrchestrator.updateCreativeMemory(workId, memory);
    return NextResponse.json({ success });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to update memory" }, { status: 500 });
  }
}
