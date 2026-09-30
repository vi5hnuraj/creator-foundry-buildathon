import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client. Uses the service key, so this module must only
 * ever be imported from server code (API route handlers, service functions) —
 * never from a client component. The service key bypasses row-level security
 * and must stay in backend env (SUPABASE_SERVICE_KEY).
 */
import { mockSupabase } from "./services/local-store";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

const isFallback = !url || !serviceKey || serviceKey.includes("NOT_SET") || url.includes("NOT_SET") || serviceKey === "" || url === "";

if (isFallback) {
  console.warn(
    "[supabase] Fallback database active. Storing works/bounties locally in data/local/.creator-foundry-db.json"
  );
}

export const supabase = isFallback
  ? (mockSupabase as any)
  : createClient(url ?? "", serviceKey ?? "", {
      auth: { persistSession: false },
    });


// ---------------------------------------------------------------------------
// Shared types — mirror the SQL schema in supabase/schema.sql
// ---------------------------------------------------------------------------

export type WorkStatus = "open" | "sealed";
export type FeeMode = "absorb" | "passthrough";

export type Work = {
  id: string;
  /** kebab-case URL handle (e.g. "neon-requiem") — unique, resolved by /work/... routes. */
  slug: string;
  title: string;
  description: string | null;
  requester_addr: string;
  asset_contract: string | null;
  work_contract: string | null;
  status: WorkStatus;
  base_price_eth: number | null;
  fee_mode: FeeMode | null;
  seal_tx_hash: string | null;
  /** Tx that committed the USDG split table on-chain (commitSplit). */
  split_tx_hash: string | null;
  /** 'onchain' once a real commitSplit landed; 'simulated' means local only. */
  seal_mode: string | null;
  created_at: string;
};

export type BountyStatus =
  | "open"
  | "claimed"
  | "delivered"
  | "approved"
  | "minted";

export type ClaimedByKind = "human" | "agent";

export type Bounty = {
  id: string;
  work_id: string;
  title: string;
  role: string;
  reward_eth: number;
  revenue_percent: number | null;
  instructions: string | null;
  deliverable_specs: string | null;
  reference_path: string | null;
  status: BountyStatus;
  claimed_by: string | null;
  claimed_by_kind: ClaimedByKind;
  delivery_ipfs: string | null;
  delivery_path: string | null;
  revision_feedback: string | null;
  revision_ref_image: string | null;
  token_id: string | null;
  tx_hash: string | null;
  /** 'onchain' when a real mint landed; 'simulated' when nothing was minted. */
  mint_mode: string | null;
  // --- On-chain escrow (CreatorFoundryBountyEscrow) ------------------------
  /** keccak256 of the canonical brief; locked in escrow at fund time. */
  brief_hash: string | null;
  /** keccak256 of the delivered artifact bytes, attested by the contributor. */
  delivery_hash: string | null;
  /** Tx that locked the reward in escrow (producer). */
  escrow_tx: string | null;
  escrow_funded_at: string | null;
  /** Tx that named the contributor and started the SLA clocks (producer). */
  escrow_assign_tx: string | null;
  /** Tx where the contributor attested the delivery hash. */
  attest_tx: string | null;
  /** Critic score stamped at release time (0–100). */
  escrow_release_score: number | null;
  /** Tx that moved the money out — release (producer) or auto-release (SLA). */
  escrow_release_tx: string | null;
  /** 'release' | 'auto' | 'refund' — how the escrow ended. */
  escrow_release_kind: string | null;
  /** Direct-transfer fallback tx when escrow isn't deployed. */
  payment_tx_hash: string | null;
  /** SLA windows chosen by the producer, in seconds. */
  delivery_window_seconds: number | null;
  review_window_seconds: number | null;
  /** Last critic report (also embedded in the minted NFT's metadata). */
  critic_feedback: unknown | null;
  created_at: string;
  updated_at: string;
};

export type SaleSource = "onchain_release" | "bridged_external";

export type Sale = {
  id: string;
  work_id: string;
  source: SaleSource;
  quantity: number;
  amount_eth: number;
  tx_hash: string | null;
  created_at: string;
};
