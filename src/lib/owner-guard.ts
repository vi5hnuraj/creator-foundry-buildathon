import { NextResponse } from "next/server";
import { supabase } from "./supabase";
import { resolveWorkParam } from "./slug-server";

/**
 * Verifies that `wallet` is the requester (owner) of the work identified by
 * `workId`. If not, returns a 403 JSON response. Callers should `return` the
 * result of this function early.
 *
 * Usage in API routes:
 *   const ownerCheck = await requireWorkOwner(workId, wallet);
 *   if (ownerCheck) return ownerCheck;
 */
export async function requireWorkOwner(workIdOrSlug: string, wallet: string | undefined | null) {
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet is required" },
      { status: 400 }
 );
  }

  // Accept slug or UUID — client code passes whichever it has.
  const resolved = await resolveWorkParam(workIdOrSlug);
  if (!resolved) {
    return NextResponse.json(
      { error: "Work not found" },
      { status: 404 }
    );
  }
  const workId = resolved.id;

  const { data: work, error } = await supabase
    .from("works")
    .select("requester_addr")
    .eq("id", workId)
    .single();

  if (error || !work) {
    return NextResponse.json(
      { error: "Work not found" },
      { status: 404 }
    );
  }

  if (work.requester_addr.toLowerCase() !== wallet.toLowerCase()) {
    return NextResponse.json(
      { error: "Only the project owner can perform this action." },
      { status: 403 }
    );
  }

  return null; // owner verified
}
