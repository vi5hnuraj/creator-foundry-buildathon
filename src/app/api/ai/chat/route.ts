import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";
import { requireWorkOwner } from "@/lib/owner-guard";

export async function POST(req: NextRequest) {
  try {
    const { prompt, workId, wallet } = await req.json();
    if (!prompt || !workId) {
      return NextResponse.json({ error: "prompt and workId are required" }, { status: 400 });
    }
    const ownerCheck = await requireWorkOwner(workId, wallet);
    if (ownerCheck) return ownerCheck;

    const memory = await FoundryOrchestrator.getCreativeMemory(workId);
    const response = await FoundryOrchestrator.processDirectorChat(prompt, workId, memory);
    
    return NextResponse.json({ response });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to process director chat" }, { status: 500 });
  }
}
