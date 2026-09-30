import { NextRequest, NextResponse } from "next/server";
import { createWork, listWorks } from "@/lib/services/works";

// GET /api/works — list all works
export async function GET() {
  const result = await listWorks();
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ works: result.data });
}

// POST /api/works — create a work (deploys the asset collection)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, description, requesterAddr } = body ?? {};
  if (!title || !requesterAddr) {
    return NextResponse.json({ error: "title and requesterAddr are required" }, { status: 400 });
  }
  const result = await createWork({ title, description, requesterAddr });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ work: result.data });
}
