import { supabase, type Work, type Sale } from "../supabase";
import { resolveWorkParam } from "../slug-server";
import { mintCopy, createSplitListing, buildRevenueSplit, type Participant } from "../asset-forge";
import type { ServiceResult } from "./bounties";

/**
 * SALES SERVICE LAYER
 *
 * Mundo A: a buyer mints a copy from the release; the split (set at seal time)
 *          pays creators + the 3% fee automatically on-chain.
 * Mundo B: an external sale (e.g. Steam) is bridged — the event is simulated,
 *          but the on-chain split payout is real.
 *
 * Same pattern: HTTP routes and the future MCP agent both call these.
 */

/**
 * Record a copy sale (Mundo A). The buyer's wallet signs the USDG payment to
 * the work's splits contract in the browser; this records the sale (and the
 * on-chain tx hash when provided) in the ledger. In demo mode the server
 * simulates the receipt so the full flow is demonstrable without testnet funds.
 */
export async function buyCopy(opts: {
  workId: string;
  quantity?: number;
  txHash?: string;
}): Promise<ServiceResult<{ txHash: string | null; tokenIds: string[]; sale: Sale }>> {
  // Accept slug or UUID (the storefront posts the pretty param it has).
  const resolved = await resolveWorkParam(opts.workId);
  if (!resolved) return { ok: false, error: "Work not found" };
  opts.workId = resolved.id; // canonical UUID for every query below

  const { data: work, error: wErr } = await supabase
    .from("works")
    .select("*")
    .eq("id", opts.workId)
    .single();
  if (wErr || !work) return { ok: false, error: "Work not found" };
  const w = work as Work;
  if (w.status !== "sealed") {
    return { ok: false, error: "Work is not sealed yet — no release to buy from" };
  }

  let txHash = opts.txHash;
  let tokenIds: string[] = [];
  if (!txHash) {
    // Demo mode: simulate the on-chain purchase receipt.
    const mint = await mintCopy({ contract: w.work_contract ?? "", quantity: opts.quantity ?? 1 });
    if (!mint.ok || !mint.data) {
      return { ok: false, error: `Copy purchase failed: ${mint.error ?? "unknown"}` };
    }
    txHash = mint.data.txHash ?? undefined;
    tokenIds = mint.data.tokenIds;
  }

  const amount = (w.base_price_eth ?? 0) * (opts.quantity ?? 1);
  const { data: sale, error: sErr } = await supabase
    .from("sales")
    .insert({
      work_id: opts.workId,
      source: "usdg_storefront",
      quantity: opts.quantity ?? 1,
      amount_eth: amount,
      tx_hash: txHash,
    })
    .select()
    .single();
  if (sErr) return { ok: false, error: "Sold on-chain but failed to record (check tx)" };

  return {
    ok: true,
    data: { txHash: txHash ?? null, tokenIds, sale: sale as Sale },
  };
}

/**
 * Bridge an external sale (Mundo B). The external event (a Steam purchase) is
 * simulated by the caller; this fires a REAL on-chain split listing so the
 * creators + fee get paid for that external sale.
 *
 * NOTE: `listing create` lists a specific token, so the bridge needs a receipt
 * token id on a contract it controls. For the MVP the caller passes the
 * receipt contract + token id (minted ahead of time, as the validation showed).
 *
 * This is the function the MCP agent will call when it detects an external
 * sale — same logic, agent instead of a mock button.
 */
export async function bridgeExternalSale(opts: {
  workId: string;
  receiptContract: string;
  receiptTokenId: string;
  priceEth: string;
  principalAddress: string;
  participants: Participant[];
}): Promise<ServiceResult<{ txHash: string; sale: Sale }>> {
  // Build the same fair split used at seal time (creators + 3% fee), then
  // consolidate happens inside buildRevenueSplit.
  const { splits } = buildRevenueSplit({
    principalAddress: opts.principalAddress,
    participants: opts.participants,
  });

  // ONCHAIN: list the receipt token with the split. (A buyer then completes it;
  // in the demo the same actor buys it to show the payout.)
  const listing = await createSplitListing({
    contract: opts.receiptContract,
    tokenId: opts.receiptTokenId,
    priceEth: opts.priceEth,
    splits,
  });
  if (!listing.ok || !listing.data) {
    return { ok: false, error: `Bridge listing failed: ${listing.error ?? "unknown"}` };
  }

  const { data: sale, error: sErr } = await supabase
    .from("sales")
    .insert({
      work_id: opts.workId,
      source: "bridged_external",
      quantity: 1,
      amount_eth: Number(opts.priceEth),
      tx_hash: (listing.data as { txHash?: string }).txHash ?? null,
    })
    .select()
    .single();
  if (sErr) return { ok: false, error: "Bridged on-chain but failed to record (check tx)" };

  return {
    ok: true,
    data: { txHash: (listing.data as { txHash?: string }).txHash ?? "", sale: sale as Sale },
  };
}

/** List sales for a work (monitoring dashboard). Accepts slug or UUID. */
export async function listSales(workIdOrSlug: string): Promise<ServiceResult<Sale[]>> {
  const resolved = await resolveWorkParam(workIdOrSlug);
  if (!resolved) return { ok: true, data: [] };
  const workId = resolved.id;
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as Sale[] };
}
