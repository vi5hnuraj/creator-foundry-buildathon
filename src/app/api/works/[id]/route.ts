import { NextRequest, NextResponse } from "next/server";
import { getWorkWithBounties, openBounty } from "@/lib/services/works";
import { requireWorkOwner } from "@/lib/owner-guard";
import { resolveWorkParam } from "@/lib/slug-server";

// GET /api/works/:id — work + its bounties (bounty board)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const result = await getWorkWithBounties(params.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result.data);
}

// POST /api/works/:id — open a bounty within this work
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { title, role, rewardEth, revenuePercent, instructions, deliverableSpecs, referencePath, wallet } =
    body ?? {};
  if (!title || !role || rewardEth == null) {
    return NextResponse.json({ error: "title, role, rewardEth are required" }, { status: 400 });
  }
  // Canonicalize slug → UUID before any write, so bounty rows always carry
  // the work's real id no matter which URL form the client is on.
  const resolved = await resolveWorkParam(params.id);
  if (!resolved) return NextResponse.json({ error: "Work not found" }, { status: 404 });
  const ownerCheck = await requireWorkOwner(resolved.id, wallet);
  if (ownerCheck) return ownerCheck;
  const result = await openBounty({
    workId: resolved.id,
    title,
    role,
    rewardEth: Number(rewardEth),
    revenuePercent: revenuePercent != null ? Number(revenuePercent) : undefined,
    instructions: instructions || undefined,
    deliverableSpecs: deliverableSpecs || undefined,
    referencePath: referencePath || undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ bounty: result.data });
}
