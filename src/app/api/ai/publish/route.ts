import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workId = searchParams.get("workId");
    if (!workId) {
      return NextResponse.json({ error: "workId is required" }, { status: 400 });
    }

    const assets = await FoundryOrchestrator.generatePublishingAssets(workId);
    return NextResponse.json({ assets });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to load publishing assets" }, { status: 500 });
  }
}
