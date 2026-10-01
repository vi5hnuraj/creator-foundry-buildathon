import { NextRequest, NextResponse } from "next/server";
import { FoundryOrchestrator } from "@/lib/services/ai";

export async function POST(req: NextRequest) {
  try {
    const { idea, prompt } = await req.json();
    if (!idea || !prompt) {
      return NextResponse.json({ error: "idea and prompt are required" }, { status: 400 });
    }

    const response = await FoundryOrchestrator.generateStoryIdeas(idea, prompt);
    return NextResponse.json({ response });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to generate story ideas" }, { status: 500 });
  }
}
