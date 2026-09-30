"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import { servedUrl } from "@/lib/files";
import { RequireWallet } from "@/components/require-wallet";
import { HeroStat, SectionHead, EmptyState } from "@/components/editorial";
import { BountyStatusPill } from "@/components/status-pill";
import { TxLink, NftLink } from "@/components/data";
import { AssetPreview } from "@/components/asset-preview";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";
import { FileInput } from "@/components/file-input";
import { RoyaltyRevenueCard } from "@/components/royalty-revenue-card";
import { Loader2, Briefcase, UserCheck, Upload, ArrowLeft, Eye, ArrowUpRight, Lock } from "lucide-react";
import { usePublicClient, useWriteContract } from "wagmi";
import {
  formatUsdg,
  formatCountdown,
  secondsLeftUntil,
  readBountyEscrow,
  attestBountyDelivery,
  autoReleaseBountyEscrow,
  ESCROW_ENABLED,
  type EscrowReader,
  type EscrowState,
} from "@/lib/usdg-payments";

export default function ArtistPage() {
  return (
    <RequireWallet>
      <ArtistView />
    </RequireWallet>
  );
}

function ArtistView() {
  const { address } = useIdentity();
  const [works, setWorks] = useState<Record<string, Work>>({});
  const [worksList, setWorksList] = useState<Work[]>([]);
  const [available, setAvailable] = useState<Bounty[]>([]);
  const [mine, setMine] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState<Bounty | null>(null);

  // Escrow state per bounty: is this reward actually locked on-chain, and has
  // any SLA clock started? Contributors see this BEFORE they claim, which is
  // the whole point of locking the money up front.
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [escrows, setEscrows] = useState<Record<string, EscrowState | null>>({});
  const [slaBusy, setSlaBusy] = useState<string | null>(null);
  const [slaError, setSlaError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      const [worksRes, openRes, mineRes] = await Promise.all([
        apiGet<{ works: Work[] }>("/api/works"),
        apiGet<{ bounties: Bounty[] }>("/api/bounties"),
        apiGet<{ bounties: Bounty[] }>(`/api/bounties?claimedBy=${address}`),
      ]);
      setWorksList(worksRes.works);
      setWorks(Object.fromEntries(worksRes.works.map((w) => [w.id, w])));
      setAvailable(openRes.bounties);
      setMine(mineRes.bounties);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bounties");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  // One read pass across every bounty on screen (available + claimed).
  useEffect(() => {
    if (!ESCROW_ENABLED || !publicClient) return;
    const list = [...available, ...mine];
    if (list.length === 0) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = ((args: any) => publicClient.readContract(args)) as EscrowReader;
      const entries = await Promise.all(
        list.map(async (b) => [b.id, await readBountyEscrow(reader, b.id)] as const)
      );
      if (!cancelled) setEscrows(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [available, mine, publicClient]);

  // Poll while a producer review clock is running: the "take payment now" button
  // must show up by itself when the window closes. Otherwise a contributor
  // sitting on this page during the SLA would never see their own payout open.
  useEffect(() => {
    if (!ESCROW_ENABLED) return;
    const running = Object.values(escrows).some(
      (e) => !!e && e.amount > 0n && e.attested && !e.released
    );
    if (!running) return;
    const t = setInterval(() => load(), 15000);
    return () => clearInterval(t);
  }, [escrows, load]);

  /**
   * The contributor's escape hatch. Once the producer's review window closes,
   * the escrow pays out on a call from ANYONE — so an artist who has been
   * waiting on a silent producer can simply take their money.
   */
  async function claimViaSla(b: Bounty) {
    setSlaBusy(b.id);
    setSlaError(null);
    try {
      const tx = await autoReleaseBountyEscrow(writeContractAsync, { bountyId: b.id });
      await apiPost(`/api/bounties/${b.id}/escrow`, {
        wallet: address ?? undefined,
        action: "auto",
        txHash: tx,
      }).catch(() => undefined);
      await load();
    } catch (e) {
      setSlaError(e instanceof Error ? e.message : "Could not release via SLA");
    } finally {
      setSlaBusy(null);
    }
  }

  const isProducer = address
    ? worksList.some((w) => w.requester_addr.toLowerCase() === address.toLowerCase())
    : false;

  if (loading) {
    return (
      <div className="card mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 py-14 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <p className="text-[15px] font-medium text-t2">Loading contributor workspace…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md border-danger/30 bg-danger-subtle p-6 text-center">
        <p className="text-[15px] font-semibold text-danger">{error}</p>
        <button className="btn-ghost mt-4 inline-flex px-4 py-1.5 text-[13px]" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const openPool = available.reduce((s, b) => s + (Number(b.reward_eth) || 0), 0);
  const activeMine = mine.filter((b) => b.status === "claimed" || b.status === "delivered").length;
  const doneMine = mine.filter((b) => b.status === "minted").length;
  const poolLabel = Number.isInteger(openPool) ? `${openPool}` : openPool.toFixed(2);

  return (
    <div className="mx-auto w-full max-w-[1560px]">
      {/* Producer preview banner */}
      {isProducer && (
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/25 bg-accent-subtle px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Eye className="w-5 h-5 text-accent shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-t1">You are the Producer of this project.</p>
              <p className="text-xs text-t3 mt-0.5">You are currently previewing the Contributor Workspace.</p>
            </div>
          </div>
          <Link href="/works" className="btn-ghost shrink-0 px-4 py-1.5 text-xs font-semibold whitespace-nowrap">
            <ArrowLeft className="w-3 h-3" /> Return to Producer Workspace
          </Link>
        </div>
      )}

      {/* ============ HERO ============ */}
      <section className={isProducer ? "" : "pt-4"}>
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          <span className="mr-3 inline-block h-[2px] w-8 bg-[color:var(--amber)] align-middle" />
          {isProducer ? "Previewing as contributor" : "Contributor hub"}
        </p>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="min-w-0">
            <h1 className="rf-display text-[clamp(2.6rem,6vw,4.75rem)] leading-[1.03] tracking-[-0.02em] text-t1">
              Claim the work.
              <br />
              Own the upside.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-t3 md:text-lg">
              Claim production tasks, create assets, upload deliverables, receive AI
              feedback, and earn automated royalty payouts on every future sale.
            </p>
          </div>
          {isProducer && (
            <span className="pill border-accent/30 bg-accent-subtle px-3 py-1 text-xs font-semibold text-accent">
              Preview Only — claiming disabled
            </span>
          )}
        </div>

        {/* Stat strip — hairline grid */}
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat label="Open assignments" value={available.length} note="ready to claim" />
          <HeroStat label="Reward pool" value={`${poolLabel} USDG`} note="across every open brief" />
          <HeroStat label="Your active tasks" value={activeMine} note="claimed, in progress" />
          <HeroStat label="Completed" value={doneMine} note="minted on-chain" tone="text-success" />
        </div>
      </section>

      {/*
        ============ REVENUE ============
        Copy sales pay the split contract; the contributor takes their share
        themselves. This lives here (not only on the work board) because
        /work/:id is owner-only — without it a contributor could be credited
        on-chain and still have no way to withdraw.
      */}
      <RoyaltyRevenueCard hideWhenIdle className="mt-16" />

      {/* ============ AVAILABLE ============ */}
      <section className="mt-16">
        <SectionHead
          eyebrow={isProducer ? "Preview — claiming disabled" : "Ready to claim"}
          title="Available assignments"
          aside={`${available.length} open`}
        />

        {available.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-7 w-7" />}
            title="No open assignments right now."
            body="New briefs appear as soon as producers publish projects."
            action={
              <Link href="/works" className="btn-ghost mt-5 px-5 py-2 text-sm">
                Browse projects
              </Link>
            }
          />
        ) : (
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] md:grid-cols-2 xl:grid-cols-3">
            {available.map((b) => (
              <AvailableCard
                key={b.id}
                bounty={b}
                workTitle={works[b.work_id]?.title ?? "Unknown work"}
                workSlug={works[b.work_id]?.slug}
                escrow={escrows[b.id] ?? null}
                onClaimed={load}
                isProducer={isProducer}
              />
            ))}
          </div>
        )}
      </section>

      {/* ============ ASSIGNED ============ */}
      <section className="mt-16 pb-6">
        <SectionHead
          eyebrow="In progress or delivered"
          title="Your assignments"
          aside={`${mine.length} total`}
        />

        {mine.length === 0 ? (
          <EmptyState
            icon={<UserCheck className="h-7 w-7" />}
            title="Nothing claimed yet."
            body="Accept an assignment above and it will move here with its delivery workflow."
          />
        ) : (
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] lg:grid-cols-2">
            {mine.map((b) => (
              <MineCard
                key={b.id}
                bounty={b}
                work={works[b.work_id]}
                workTitle={works[b.work_id]?.title ?? "Unknown work"}
                workSlug={works[b.work_id]?.slug}
                escrow={escrows[b.id] ?? null}
                onDeliver={() => setDelivering(b)}
                onClaimSla={() => claimViaSla(b)}
                slaBusy={slaBusy === b.id}
                slaError={slaBusy === b.id ? slaError : null}
                isProducer={isProducer}
              />
            ))}
          </div>
        )}
      </section>

      {delivering && (
        <DeliverModal
          bounty={delivering}
          wallet={address ?? ""}
          escrow={escrows[delivering.id] ?? null}
          onClose={() => setDelivering(null)}
          onDone={() => {
            setDelivering(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared editorial pieces live in @/components/editorial             */
/* ------------------------------------------------------------------ */

function RolePill({ role }: { role: string }) {
  const label = (role || "other").replace(/_/g, " ");
  return (
    <span className="rf-data inline-flex shrink-0 rounded-full border border-info/25 bg-info-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-info">
      {label}
    </span>
  );
}

function RewardStats({ bounty }: { bounty: Bounty }) {
  return (
    <div className="flex gap-7">
      <div>
        <div className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">Reward</div>
        <div className="rf-data mt-1 text-xl leading-none text-t1">
          {bounty.reward_eth} <span className="text-[13px] text-t3">USDG</span>
        </div>
      </div>
      <div>
        <div className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">Royalty</div>
        <div className="rf-data mt-1 text-xl leading-none text-accent">
          {bounty.revenue_percent != null ? `${bounty.revenue_percent}%` : "—"}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Available assignment card                                           */
/* ------------------------------------------------------------------ */

function AvailableCard({
  bounty,
  workTitle,
  workSlug,
  escrow,
  onClaimed,
  isProducer,
}: {
  bounty: Bounty;
  workTitle: string;
  workSlug?: string;
  escrow: EscrowState | null;
  onClaimed: () => void;
  isProducer: boolean;
}) {
  const { address } = useIdentity();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = bounty;
  const locked = !!escrow && escrow.amount > 0n && !escrow.released;

  const brief = b.instructions
    ? b.instructions.length > 150
      ? `${b.instructions.slice(0, 150).trimEnd()}…`
      : b.instructions
    : null;

  async function claim() {
    if (claiming || !address) return;
    setClaiming(true);
    setError(null);
    try {
      await apiPost(`/api/bounties/${b.id}/claim`, {
        wallet: address,
        kind: "human",
      });
      onClaimed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
      setClaiming(false);
    }
  }

  return (
    <article className="group flex flex-col bg-surface p-6 transition-colors hover:bg-surface-raised">
      <div className="flex items-center justify-between gap-3">
        <RolePill role={b.role} />          <Link            href={`/work/${workSlug || b.work_id}`}
          className="inline-flex min-w-0 items-center gap-1 text-[13px] text-t3 transition-colors hover:text-accent"
        >
          <span className="truncate">{workTitle}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
      </div>

      <h3 className="rf-display mt-4 text-xl leading-snug text-t1">{b.title}</h3>
      <p className="mt-2 line-clamp-2 flex-1 text-[13px] leading-relaxed text-t3">
        {brief ?? "No brief attached — full details shared after you accept."}
      </p>

      {/* Escrow signal, shown BEFORE a contributor commits any work: whether
          the money for this task is already locked, or merely promised. */}
      {ESCROW_ENABLED && (
        <div className="mt-3">
          {locked ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-verified/25 bg-verified-subtle px-2.5 py-1 text-[11px] font-semibold text-verified"
              title="The producer locked this reward in escrow before opening the task. If they never review, the deadline pays you anyway."
            >
              <Lock className="h-3 w-3" /> {formatUsdg(escrow!.amount)} USDG locked
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg border border-warning/25 bg-warning-subtle px-2.5 py-1 text-[11px] font-semibold text-warning"
              title="No escrow deposit yet — this reward is a promise until it is locked."
            >
              <Lock className="h-3 w-3" /> Reward not locked yet
            </span>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-[color:var(--border-subtle)] pt-4">
        <RewardStats bounty={b} />
        {error && <span className="text-xs font-semibold text-danger">{error}</span>}
        {isProducer ? (
          <span className="inline-flex cursor-not-allowed items-center rounded-lg border border-[color:var(--border)] bg-surface-inset px-4 py-2 text-xs font-semibold text-t4">
            Preview only
          </span>
        ) : (
          <button
            className="btn-sticker px-4 py-2 text-[12px] uppercase tracking-[0.08em]"
            onClick={claim}
            disabled={claiming}
          >
            {claiming ? (
              <>
                <Spinner /> Claiming…
              </>
            ) : (
              "Accept assignment"
            )}
          </button>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* My assignment card                                                  */
/* ------------------------------------------------------------------ */

function MineCard({
  bounty,
  work,
  workTitle,
  workSlug,
  escrow,
  onDeliver,
  onClaimSla,
  slaBusy,
  slaError,
  isProducer,
}: {
  bounty: Bounty;
  work?: Work;
  workTitle: string;
  workSlug?: string;
  escrow: EscrowState | null;
  onDeliver: () => void;
  onClaimSla: () => void;
  slaBusy: boolean;
  slaError: string | null;
  isProducer: boolean;
}) {
  const b = bounty;
  const minted = b.status === "minted";
  const hasRevision = b.status === "claimed" && !!(b.revision_feedback || b.revision_ref_image);
  const locked = !!escrow && escrow.amount > 0n && !escrow.released;
  const paid = !!escrow?.released;

  const statusPill =
    b.status === "claimed" ? (
      <span className="pill border-info/25 bg-info-subtle text-[11px] font-semibold text-info">
        <span className="w-1.5 h-1.5 rounded-full bg-info" />
        In progress
      </span>
    ) : b.status === "delivered" ? (
      <BountyStatusPill status="delivered" label="Critic auditing" />
    ) : b.status === "approved" ? (
      <BountyStatusPill status="approved" label="Minting…" />
    ) : minted ? (
      <BountyStatusPill status="minted" label="Completed" />
    ) : (
      <BountyStatusPill status={b.status} />
    );

  return (
    <article className="flex flex-col bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <RolePill role={b.role} />
        {statusPill}
      </div>

      <div className="mt-4 flex items-start gap-4">
        {minted && b.delivery_path && (
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-[color:var(--border-subtle)]">
            <AssetPreview path={b.delivery_path} alt={b.title} className="h-full w-full object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="rf-display text-xl leading-snug text-t1">{b.title}</h3>
          <Link
            href={`/work/${workSlug || b.work_id}`}
            className="mt-1 inline-flex items-center gap-1 text-[13px] text-t3 transition-colors hover:text-accent"
          >
            <span className="truncate">{workTitle}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
        </div>
      </div>

      {hasRevision && (
        <div className="mt-4 rounded-lg border-l-2 border-warning bg-warning/5 px-3.5 py-3">
          <span className="rf-data flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4M12 17h.01" />
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
            </svg>
            Revision requested
          </span>
          {b.revision_feedback && (
            <p className="mt-1.5 text-xs leading-relaxed text-t2">{b.revision_feedback}</p>
          )}
          {b.revision_ref_image && servedUrl(b.revision_ref_image) && (
            <a
              href={servedUrl(b.revision_ref_image)!}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-info hover:underline"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              View reference image
            </a>
          )}
        </div>
      )}

      {/* Escrow state for the contributor: the money is already theirs once the
          review window closes, whether or not the producer ever signs. */}
      {ESCROW_ENABLED && escrow && (locked || paid) && (
        <div className="mt-4 rounded-lg border border-[color:var(--border-subtle)] bg-surface-inset px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Lock className={`h-3.5 w-3.5 shrink-0 ${paid ? "text-verified" : "text-info"}`} />
            {escrow.refunded ? (
              <span className="rf-data text-[11px] text-t4">
                reward returned to the producer (no delivery before the deadline)
              </span>
            ) : paid ? (
              <span className="text-[12px] font-semibold text-verified">
                {formatUsdg(escrow.amount)} USDG paid
                {b.escrow_release_kind === "auto" ? " (SLA auto-release)" : ""}
              </span>
            ) : (
              <>
                <span className="rf-data text-[11px] text-t2">
                  {formatUsdg(escrow.amount)} USDG locked for you
                </span>
                {escrow.attested ? (
                  <span
                    className={`rf-data text-[11px] ${escrow.releasable ? "text-verified" : "text-t4"}`}
                    title="When this window closes with no producer review, the escrow pays you — permissionlessly."
                  >
                    {escrow.releasable
                      ? "review window closed — you can take payment now"
                      : `producer has ${formatCountdown(secondsLeftUntil(escrow.reviewDeadline))} to review`}
                  </span>
                ) : (
                  <span className="rf-data text-[11px] text-t4">
                    delivery not attested on-chain yet
                  </span>
                )}
                {escrow.releasable && (
                  <button
                    className="btn-sticker px-3 py-1.5 text-[11px] uppercase tracking-[0.08em]"
                    onClick={onClaimSla}
                    disabled={slaBusy}
                    title="Permissionless release: the review deadline passed with no producer signature."
                  >
                    {slaBusy ? <><Spinner /> Releasing…</> : "Claim payment (SLA)"}
                  </button>
                )}
              </>
            )}
          </div>
          {slaError && <p className="mt-1 text-[11px] text-danger">{slaError}</p>}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-[color:var(--border-subtle)] pt-4">
        <RewardStats bounty={b} />

        <div className="flex flex-wrap items-center gap-3">
          {b.status === "claimed" && !isProducer && (
            <button className="btn-sticker px-4 py-2 text-[12px] uppercase tracking-[0.08em]" onClick={onDeliver}>
              <Upload className="h-3.5 w-3.5" /> Submit deliverable
            </button>
          )}
          {b.status === "claimed" && isProducer && (
            <span className="inline-flex cursor-not-allowed items-center rounded-lg border border-[color:var(--border)] bg-surface-inset px-4 py-2 text-xs font-semibold text-t4">
              Waiting for contributor
            </span>
          )}
          {minted && (
            <div className="flex flex-col items-end gap-1">
              <span className="rf-data text-xs text-t3">
                {b.token_id
                  ? `token #${b.token_id}`
                  : b.mint_mode === "simulated"
                    ? "local record · not on-chain"
                    : "token id unavailable"}
                {b.revenue_percent != null ? ` · ${b.revenue_percent}% split` : ""}
              </span>
              <div className="flex gap-3 text-[11px]">
                {b.tx_hash && <TxLink hash={b.tx_hash}>authorship</TxLink>}
                {b.escrow_release_tx && <TxLink hash={b.escrow_release_tx}>payment</TxLink>}
                {work?.asset_contract && b.token_id && (
                  <NftLink contract={work.asset_contract} tokenId={b.token_id}>
                    NFT
                  </NftLink>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function DeliverModal({
  bounty,
  wallet,
  escrow,
  onClose,
  onDone,
}: {
  bounty: Bounty;
  wallet: string;
  escrow: EscrowState | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [asset, setAsset] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [step, setStep] = useState<null | "uploading" | "saving" | "attesting">(null);
  const [error, setError] = useState<string | null>(null);
  const [attestWarning, setAttestWarning] = useState<string | null>(null);
  const busy = step !== null;

  const escrowLocked = !!escrow && escrow.amount > 0n && !escrow.released;
  const assignedToMe =
    !!escrow &&
    escrow.contributor.toLowerCase() === wallet.toLowerCase() &&
    escrow.contributor !== "0x0000000000000000000000000000000000000000";

  const assetIsImage = asset?.type.startsWith("image/") ?? false;
  const needsPreview = !!asset && !assetIsImage;
  const canSubmit = !!asset && (assetIsImage || !!preview);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset || busy) return;
    if (needsPreview && !preview) {
      setError("This asset isn't an image — add a preview image for the NFT media.");
      return;
    }
    setError(null);
    try {
      setStep("uploading");
      const assetRes = await apiUpload(asset);
      let deliveryPath = assetRes.path;
      let deliveryIpfs: string | undefined = assetRes.url;
      if (!assetRes.isImage) {
        const previewRes = await apiUpload(preview!);
        deliveryPath = previewRes.path;
        deliveryIpfs = assetRes.url;
      }
      setStep("saving");
      await apiPost(`/api/bounties/${bounty.id}/deliver`, {
        wallet,
        deliveryPath,
        deliveryIpfs,
      });

      // When the reward is escrowed and assigned to me, attest the delivery
      // hash on-chain. This starts the producer's review clock, which is what
      // makes the auto-release deadline enforceable — without it the pledge to
      // pay automatically has no trigger. Failure here is NOT fatal: the
      // producer can still release, they just lose the automatic backstop.
      if (escrowLocked && assignedToMe) {
        try {
          setStep("attesting");
          const attest = await apiGet<{ deliveryHash?: string }>(
            `/api/bounties/${bounty.id}/attest`
          );
          if (attest.deliveryHash) {
            const tx = await attestBountyDelivery(writeContractAsync, {
              bountyId: bounty.id,
              deliveryHash: attest.deliveryHash as `0x${string}`,
            });
            await apiPost(`/api/bounties/${bounty.id}/escrow`, {
              wallet,
              action: "attest",
              txHash: tx,
              deliveryHash: attest.deliveryHash,
            });
          } else {
            setAttestWarning(
              "Delivered, but the file hash could not be computed — the review clock did not start."
            );
          }
        } catch (attestErr) {
          console.warn("delivery attestation failed:", attestErr);
          setAttestWarning(
            "Delivered, but the on-chain attestation needs a signature. You are still able to deliver again or ask the producer to release."
          );
        }
      }

      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delivery failed");
      setStep(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Deliver task asset">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-t3 leading-relaxed">
          Deliver the final file (image, 3D, audio, code). It will be registered on Arbitrum upon producer review approval.
        </p>

        {(bounty.instructions || bounty.deliverable_specs || bounty.reference_path) && (
          <div className="space-y-3 rounded-xl border border-[color:var(--border-subtle)] bg-surface-inset p-4 text-xs">
            {bounty.instructions && (
              <div>
                <div className="rf-data text-[10px] uppercase font-semibold text-t4 tracking-wider mb-1">Director Brief</div>
                <p className="whitespace-pre-wrap text-t2 leading-relaxed">{bounty.instructions}</p>
              </div>
            )}
            {bounty.deliverable_specs && (
              <div>
                <div className="rf-data text-[10px] uppercase font-semibold text-t4 tracking-wider mb-1">Technical Specs</div>
                <p className="whitespace-pre-wrap text-t2 leading-relaxed">{bounty.deliverable_specs}</p>
              </div>
            )}
            {bounty.reference_path && servedUrl(bounty.reference_path) && (
              <a
                href={servedUrl(bounty.reference_path)!}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-info hover:underline"
              >
                ↓ Download project reference asset
              </a>
            )}
            {(bounty.revision_feedback || bounty.revision_ref_image) && (
              <div className="border-t border-warning/20 pt-3 mt-3">
                <span className="rf-data text-[10px] font-semibold text-warning uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                  Revision Requested
                </span>
                {bounty.revision_feedback && (
                  <p className="text-xs text-t2 whitespace-pre-wrap leading-relaxed bg-warning/5 rounded-lg p-3 border border-warning/15">{bounty.revision_feedback}</p>
                )}
                {bounty.revision_ref_image && servedUrl(bounty.revision_ref_image) && (
                  <a
                    href={servedUrl(bounty.revision_ref_image)!}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-info hover:underline"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                    View reference image from director
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label className="rf-data text-[10px] uppercase font-semibold text-t4 tracking-wider">Deliverable File</label>
          <FileInput accept="*" disabled={busy} onChange={setAsset} label="Choose asset file" />
        </div>

        {needsPreview && (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-surface-raised p-4 space-y-2">
            <p className="text-[11px] text-t3 leading-relaxed">
              <span className="font-mono text-t2 font-semibold">{asset?.name}</span> is not a direct image. 
              Upload a preview image to represent this asset in the NFT gallery.
            </p>
            <FileInput
              accept="image/*"
              disabled={busy}
              onChange={setPreview}
              label="Choose preview image"
            />
          </div>
        )}

        {attestWarning && (
          <p className="text-xs font-semibold text-warning">{attestWarning}</p>
        )}
        {error && <p className="text-xs text-danger font-semibold">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
            {step === "uploading" ? (
              <><Spinner /> Uploading…</>
            ) : step === "saving" ? (
              <><Spinner /> Registering…</>
            ) : step === "attesting" ? (
              <><Spinner /> Attesting hash…</>
            ) : (
              "Submit Delivery"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
