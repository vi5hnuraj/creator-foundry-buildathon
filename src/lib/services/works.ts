import { supabase, type Work, type Bounty, type FeeMode } from "../supabase";
import { ensureWorkSlug, resolveWorkParam } from "../slug-server";
import {
  deployAssetCollection,
  deployWorkCollection,
  prepareLazyMint,
  sealWork as sealWorkOnchain,
  type Participant,
} from "../asset-forge";
import type { ServiceResult } from "./bounties";

/**
 * WORK SERVICE LAYER
 *
 * Pure action functions for the requester (principal creator) flow. Same
 * pattern as bounties: HTTP routes and the future MCP agent both call these.
 */

/**
 * Create a work and deploy its ASSET collection (erc721). The asset contract
 * is where individual creator assets get minted. (Requester step 1.)
 */
export async function createWork(opts: {
  title: string;
  description?: string;
  requesterAddr: string;
}): Promise<ServiceResult<Work>> {
  // Defer contract deployment. Save project directly to DB.
  const { data, error } = await supabase
    .from("works")
    .insert({
      title: opts.title,
      description: opts.description ?? null,
      requester_addr: opts.requesterAddr,
      asset_contract: null, // Deferred until publishing stage
      status: "open",
    })
    .select()
    .single();

  if (error) return { ok: false, error: `Failed to register project: ${error.message}` };
  const work = data as Work;
  // Human-readable URL handle for /work/:slug (best effort — id fallback keeps URLs valid).
  await ensureWorkSlug(work.id, work.title);
  return { ok: true, data: work };
}

/** Open a bounty within a work. (Requester step 2.) */
export async function openBounty(opts: {
  workId: string;
  title: string;
  role: string;
  rewardEth: number;
  revenuePercent?: number;
  instructions?: string;
  deliverableSpecs?: string;
  referencePath?: string;
}): Promise<ServiceResult<Bounty>> {
  const insert: Record<string, unknown> = {
    work_id: opts.workId,
    title: opts.title,
    role: opts.role,
    reward_eth: opts.rewardEth,
    revenue_percent: opts.revenuePercent ?? null,
    status: "open",
  };
  // Only reference the brief columns when a value is provided, so opening a
  // bounty without a brief keeps working before the migration is applied.
  if (opts.instructions !== undefined) insert.instructions = opts.instructions;
  if (opts.deliverableSpecs !== undefined) insert.deliverable_specs = opts.deliverableSpecs;
  if (opts.referencePath !== undefined) insert.reference_path = opts.referencePath;

  const { data, error } = await supabase
    .from("bounties")
    .insert(insert)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Bounty };
}

/** Get a work with its bounties (for the bounty board screen). */
export async function getWorkWithBounties(
  workIdOrSlug: string
): Promise<ServiceResult<{ work: Work; bounties: Bounty[] }>> {
  // Accept the slug ("neon-requiem") or the legacy UUID interchangeably.
  const resolved = await resolveWorkParam(workIdOrSlug);
  if (!resolved) return { ok: false, error: "Work not found" };
  const workId = resolved.id;

  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };

  const { data: bounties, error: bErr } = await supabase
    .from("bounties")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: true });
  if (bErr) return { ok: false, error: bErr.message };

  return { ok: true, data: { work: work as Work, bounties: (bounties ?? []) as Bounty[] } };
}

/** List all works (gallery / requester dashboard). */
export async function listWorks(): Promise<ServiceResult<Work[]>> {
  const { data, error } = await supabase
    .from("works")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Work[] };
}

/**
 * Seal the work for the Arbitrum buildathon: record the sealed state and the
 * USDG price. The on-chain split table is committed wallet-side from the seal
 * page (commitSplit on the work's CreatorFoundrySplits contract); this server
 * path handles the demo fallback where no contract is configured.
 *
 * The participants come from the minted bounties' revenue_percent values; the
 * principal is the work's requester and keeps the remainder.
 */
export async function sealWork(opts: {
  workId: string;
  basePriceEth: number;
  feeMode: FeeMode;
  imagePath: string; // cover/base image for the work release
}): Promise<ServiceResult<{ work: Work; breakdown: unknown }>> {
  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", opts.workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };
  const w = work as Work;
  if (w.status === "sealed") return { ok: false, error: "Work is already sealed" };

  // Gather minted bounties to build the participant list.
  const { data: bounties } = await supabase
    .from("bounties")
    .select("*")
    .eq("work_id", opts.workId)
    .eq("status", "minted");

  const participants: Participant[] = ((bounties ?? []) as Bounty[])
    .filter((b) => b.claimed_by && b.revenue_percent && b.revenue_percent > 0)
    .map((b) => ({
      address: b.claimed_by!,
      role: b.role,
      percent: b.revenue_percent!,
    }));

  // Demo fallback seal (no on-chain contract configured) — compute the split
  // breakdown for the UI; the wallet-signed path commits it on-chain instead.
  const seal = await sealWorkOnchain({
    contract: w.work_contract ?? "",
    basePriceEth: opts.basePriceEth,
    principalAddress: w.requester_addr,
    participants,
    feeMode: opts.feeMode,
  });
  if (!seal.ok || !seal.data) {
    return { ok: false, error: `Seal failed: ${seal.error ?? "unknown"}` };
  }
  const workContract = w.work_contract ?? null;

  // Record the sealed state.
  const { data: updated, error: updErr } = await supabase
    .from("works")
    .update({
      status: "sealed",
      work_contract: workContract,
      base_price_eth: opts.basePriceEth,
      fee_mode: opts.feeMode,
      seal_tx_hash: seal.data.txHash,
      // DEMO mode commits nothing on-chain; marked so the UI never links a
      // non-existent transaction.
      seal_mode: (seal.data as { simulated?: boolean }).simulated ? "simulated" : "onchain",
    })
    .eq("id", opts.workId)
    .select()
    .single();

  if (updErr) return { ok: false, error: "Sealed on-chain but failed to record (check tx)" };
  return { ok: true, data: { work: updated as Work, breakdown: seal.breakdown } };
}

/**
 * Wallet-signed seal: the user already signed the mint via MetaMask.
 * Just record the sealed state in the database — no direct on-chain calls from the API layer.
 */
export async function sealWorkWallet(opts: {
  workId: string;
  basePriceEth: number;
  feeMode: FeeMode;
  imagePath: string;
  txHash: string;
  /** commitSplit tx — without it the storefront cannot distribute a sale. */
  splitsTxHash?: string;
}): Promise<ServiceResult<{ work: Work; breakdown: unknown }>> {
  const { data: updated, error: updErr } = await supabase
    .from("works")
    .update({
      status: "sealed",
      base_price_eth: opts.basePriceEth,
      fee_mode: opts.feeMode,
      seal_tx_hash: opts.txHash,
      split_tx_hash: opts.splitsTxHash ?? null,
      seal_mode: "onchain", // wallet-signed by the producer
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.workId)
    .select()
    .single();

  if (updErr) return { ok: false, error: `Failed to seal: ${updErr.message}` };
  return { ok: true, data: { work: updated as Work, breakdown: [] } };
}
