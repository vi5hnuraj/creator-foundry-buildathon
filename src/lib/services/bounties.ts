import { supabase, type Bounty, type ClaimedByKind } from "../supabase";
import { mintAsset } from "../asset-forge";
import { downloadToTemp, removeTemp } from "../storage";

/**
 * BOUNTY SERVICE LAYER
 *
 * These are pure action functions — the single source of truth for every
 * bounty operation. Both the HTTP route handlers (for the UI) AND the agents
 * in lib/services/ai.ts call these same functions, so HTTP and AI share one
 * code path with zero duplicated logic.
 *
 * Convention: each function returns { ok, data?, error? } so callers (HTTP or
 * agent) handle success/failure uniformly.
 */

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Discover open bounties — optionally scoped to one work. (Artist step 1.) */
export async function listOpenBounties(workId?: string): Promise<ServiceResult<Bounty[]>> {
  let query = supabase.from("bounties").select("*").eq("status", "open");
  if (workId) query = query.eq("work_id", workId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Bounty[] };
}

/** List bounties claimed by a given wallet (artist's "my tasks" view). */
export async function listBountiesByClaimer(wallet: string): Promise<ServiceResult<Bounty[]>> {
  const { data, error } = await supabase
    .from("bounties")
    .select("*")
    .eq("claimed_by", wallet)
    .order("updated_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Bounty[] };
}

/**
 * Claim an open bounty. (Artist step 2.) Works for both humans and agents —
 * the `kind` flag records which. Uses a guarded update so two actors can't
 * claim the same bounty: we only transition rows still in 'open'.
 */
export async function claimBounty(opts: {
  bountyId: string;
  wallet: string;
  kind?: ClaimedByKind;
}): Promise<ServiceResult<Bounty>> {
  const { data, error } = await supabase
    .from("bounties")
    .update({
      status: "claimed",
      claimed_by: opts.wallet,
      claimed_by_kind: opts.kind ?? "human",
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.bountyId)
    .eq("status", "open") // guard: only claim if still open
    .select()
    .single();

  if (error) {
    // No row updated usually means it was already claimed.
    return { ok: false, error: "Bounty is no longer open (already claimed?)" };
  }
  return { ok: true, data: data as Bounty };
}

/**
 * Deliver an asset for a claimed bounty. (Artist step 4.) Records the IPFS ref
 * and the local path the mint will use, and moves the bounty to 'delivered'.
 * Only the wallet that claimed it may deliver.
 */
export async function deliverBounty(opts: {
  bountyId: string;
  wallet: string;
  deliveryIpfs?: string;
  deliveryPath: string; // served /api/files path for the minted asset
}): Promise<ServiceResult<Bounty>> {
  const { data, error } = await supabase
    .from("bounties")
    .update({
      status: "delivered",
      delivery_ipfs: opts.deliveryIpfs ?? null,
      delivery_path: opts.deliveryPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.bountyId)
    .eq("claimed_by", opts.wallet) // guard: only the claimer delivers
    .eq("status", "claimed")
    .select()
    .single();

  if (error) {
    return { ok: false, error: "Could not deliver (not claimed by you, or wrong state)" };
  }
  return { ok: true, data: data as Bounty };
}

/**
 * Request changes: bounce a delivered bounty back to 'claimed' so the artist
 * can re-deliver. Optionally stores revision feedback and a reference image
 * so the contributor knows exactly what to fix.
 */
export async function requestChanges(
  bountyId: string,
  opts?: { feedback?: string; refImagePath?: string }
): Promise<ServiceResult<Bounty>> {
  const update: Record<string, unknown> = {
    status: "claimed",
    updated_at: new Date().toISOString(),
  };
  if (opts?.feedback) update.revision_feedback = opts.feedback;
  if (opts?.refImagePath) update.revision_ref_image = opts.refImagePath;

  const { data, error } = await supabase
    .from("bounties")
    .update(update)
    .eq("id", bountyId)
    .eq("status", "delivered")
    .select()
    .single();
  if (error) return { ok: false, error: "Could not request changes (wrong state?)" };
  return { ok: true, data: data as Bounty };
}

/**
 * Approve a delivered bounty. This is an ONCHAIN action (Requester step 4,
 * "aprueba" branch): it mints the asset to the creator with the creator as the
 * ERC-2981 royalty receiver, then records the token id + tx hash and moves the
 * bounty to 'minted'.
 *
 * Needs the work's asset contract address (passed in by the caller, who has
 * the work loaded). The mint records the asset on Arbitrum with ERC-2981 royalties.
 */
export async function approveAndMint(opts: {
  bountyId: string;
  assetContract: string;
  txHash?: string;
  tokenId?: string;
}): Promise<ServiceResult<Bounty>> {
  // Load the bounty to get delivery + creator details.
  const { data: bounty, error: loadErr } = await supabase
    .from("bounties")
    .select("*")
    .eq("id", opts.bountyId)
    .single();
  if (loadErr || !bounty) return { ok: false, error: "Bounty not found" };

  const b = bounty as Bounty;
  if (b.status !== "delivered") {
    return { ok: false, error: `Bounty must be 'delivered' to approve (is '${b.status}')` };
  }
  if (!b.claimed_by || !b.delivery_path) {
    return { ok: false, error: "Bounty missing claimer or delivery path" };
  }

  // If the wallet already signed the mint transaction, use real on-chain data
  if (opts.txHash) {
    const { data: updated, error: updErr } = await supabase
      .from("bounties")
      .update({
        status: "minted",
        token_id: opts.tokenId || "pending",
        tx_hash: opts.txHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", opts.bountyId)
      .select()
      .single();

    if (updErr) return { ok: false, error: `Failed to record approval: ${updErr.message}` };
    return { ok: true, data: updated as Bounty };
  }

  // If the asset contract is deferred (not deployed yet), we bypass on-chain
  // minting and record a LOCAL approval. Critically: no tx hash and no token id
  // are invented here — a fabricated-looking hash used to get stored and then
  // rendered as an explorer link to a transaction that never existed.
  if (!opts.assetContract || opts.assetContract === "deferred" || opts.assetContract === "0x0000000000000000000000000000000000000000") {
    const { data: updated, error: updErr } = await supabase
      .from("bounties")
      .update({
        status: "minted",
        token_id: null,
        tx_hash: null,
        mint_mode: "simulated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", opts.bountyId)
      .select()
      .single();

    if (updErr) return { ok: false, error: `Failed to record approval: ${updErr.message}` };
    return { ok: true, data: updated as Bounty };
  }

  // Move to 'approved' first so the UI reflects intent even if the chain is slow.
  await supabase
    .from("bounties")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", opts.bountyId);

  // The deliverable lives in object storage; minting needs the raw BYTES.
  // Download it to a temp file, mint from that, and always clean up.
  let tempImagePath: string | null = null;
  try {
    tempImagePath = await downloadToTemp(b.delivery_path);
  } catch (e) {
    // Couldn't fetch the asset → nothing minted. Roll back so it can be retried.
    await supabase
      .from("bounties")
      .update({ status: "delivered", updated_at: new Date().toISOString() })
      .eq("id", opts.bountyId);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not fetch the delivered asset from storage",
    };
  }

  try {
    // ONCHAIN: mint the asset to the creator (creator = royalty receiver).
    const mint = await mintAsset({
      contract: opts.assetContract,
      name: b.title,
      description: `${b.role} — Creator Foundry asset`,
      imagePath: tempImagePath,
      creatorAddress: b.claimed_by,
      attributes: [{ trait: "role", value: b.role }],
    });

    if (!mint.ok || !mint.data) {
      // Roll back to 'delivered' so it can be retried.
      await supabase
        .from("bounties")
        .update({ status: "delivered", updated_at: new Date().toISOString() })
        .eq("id", opts.bountyId);
      return { ok: false, error: `Mint failed: ${mint.error ?? "unknown error"}` };
    }

    const { data: updated, error: updErr } = await supabase
      .from("bounties")
      .update({
        status: "minted",
        token_id: mint.data.tokenId,
        tx_hash: mint.data.txHash,
        mint_mode: mint.data.simulated ? "simulated" : "onchain",
        updated_at: new Date().toISOString(),
      })
      .eq("id", opts.bountyId)
      .select()
      .single();

    if (updErr) return { ok: false, error: "Minted on-chain but failed to record (check tx)" };
    return { ok: true, data: updated as Bounty };
  } finally {
    // Always remove the temp file, even if the mint threw or failed.
    await removeTemp(tempImagePath);
  }
}
