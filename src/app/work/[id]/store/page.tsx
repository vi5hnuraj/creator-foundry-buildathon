"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isUuid } from "@/lib/slug";
import type { Work, Bounty, Sale } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api";
import { useIdentity, truncateAddress } from "@/lib/use-identity";
import { buildRoyaltyRows } from "@/lib/split-math";
import { RequireWallet } from "@/components/require-wallet";
import { HeroStat, SectionHead, EmptyState } from "@/components/editorial";
import { Spinner } from "@/components/spinner";
import { PendingButton } from "@/components/pending-button";
import { TxLink, Address } from "@/components/data";
import { RoyaltyTable } from "@/components/royalty-table";
import { useWriteContract } from "wagmi";
import { ACTIVE_CHAIN } from "@/lib/chains";
import { buyCopyInUsdg } from "@/lib/usdg-payments";
import { SPLITS_CONTRACT_ADDRESS } from "@/lib/nft-contract";
import { ArrowLeft, Loader2, Store, Sparkles, Receipt } from "lucide-react";

type Board = { work: Work; bounties: Bounty[] };
type PublishingPack = {
  steamCopy: string;
  socialThread: string[];
  portfolioBrief: string;
};

export default function StorePage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <StoreInner workId={params.id} />
    </RequireWallet>
  );
}

function StoreInner({ workId }: { workId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [buying, setBuying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();

  // Publishing Agent States
  const [pubAssets, setPubAssets] = useState<PublishingPack | null>(null);
  const [loadingPub, setLoadingPub] = useState(false);

  const loadSales = useCallback(async () => {
    const { sales } = await apiGet<{ sales: Sale[] }>(`/api/sales?work=${workId}`);
    setSales(sales);
  }, [workId]);

  const loadPublishing = useCallback(async () => {
    setLoadingPub(true);
    try {
      const data = await apiGet<{ assets: PublishingPack }>(`/api/ai/publish?workId=${workId}`);
      setPubAssets(data.assets);
    } catch (e) {
      console.error("Failed to load publishing details", e);
    } finally {
      setLoadingPub(false);
    }
  }, [workId]);

  const load = useCallback(async () => {
    try {
      const [b] = await Promise.all([
        apiGet<Board>(`/api/works/${workId}`),
        loadSales(),
        loadPublishing(),
      ]);
      setBoard(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load store");
    } finally {
      setLoading(false);
    }
  }, [workId, loadSales, loadPublishing]);

  // Legacy UUID store URLs resolve fine, but the pretty slug URL is canonical.
  useEffect(() => {
    if (board?.work && isUuid(workId)) {
      router.replace(`/work/${board.work.slug || board.work.id}/store`, { scroll: false });
    }
  }, [board?.work, workId, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 py-14 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <p className="text-[15px] font-medium text-t2">Loading storefront…</p>
      </div>
    );
  }
  if (error || !board) {
    return (
      <div className="card mx-auto mt-16 max-w-md border-danger/30 bg-danger-subtle p-6 text-center">
        <p className="text-[15px] font-semibold text-danger">{error ?? "Not found"}</p>
        <button className="btn-ghost mt-4 inline-flex px-4 py-1.5 text-[13px]" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const { work, bounties } = board;

  if (work.status !== "sealed") {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState
          icon={<Store className="h-7 w-7" />}
          title="Storefront is not active yet."
          body="This work hasn't been sealed — no copies are ready for sale."
          action={
            <Link
              href={`/work/${work.slug || work.id}`}
              className="btn-sticker mt-5 inline-flex px-5 py-2.5 text-[13px] uppercase tracking-[0.08em]"
            >
              Back to workboard
            </Link>
          }
        />
      </div>
    );
  }

  const price = work.base_price_eth ?? 0;
  const copiesSold = sales.reduce((s, x) => s + x.quantity, 0);
  const totalRevenue = sales.reduce((s, x) => s + x.amount_eth, 0);
  const paidToCreators = totalRevenue * 0.97; // ~3% Creator Foundry fee underneath
  const royaltyRows = buildRoyaltyRows(
    work.requester_addr,
    bounties
      .filter((b) => b.status === "minted" && b.claimed_by && (b.revenue_percent ?? 0) > 0)
      .map((b) => ({ address: b.claimed_by!, role: b.role, percent: b.revenue_percent! }))
  );

  async function buy() {
    if (buying) return;
    setBuying(true);
    setActionError(null);
    try {
      // Wallet-signed USDG purchase. Funds land on the work's splits contract
      // (when configured) and are released pro-rata to every contributor
      // on-chain; the sale is then recorded in the DB for the storefront.
      let txHash: string | undefined;
      const splitsTarget = work.work_contract ?? SPLITS_CONTRACT_ADDRESS;
      const onChainReady =
        splitsTarget && splitsTarget !== "0x0000000000000000000000000000000000000000";
      if (onChainReady) {
        txHash = await buyCopyInUsdg(writeContractAsync, {
          splitsContract: splitsTarget,
          amount: price,
        });
      }
      await apiPost("/api/sales/buy", { workId, txHash });
      await loadSales();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Buy failed");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1560px]">
      <Link
        href={`/work/${work.slug || work.id}`}
        className="inline-flex items-center gap-1.5 text-xs text-t3 transition-colors hover:text-t1"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to {work.title} workspace
      </Link>

      {/* ============ HERO + BUY ============ */}
      <section className="mt-6">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          <span className="mr-3 inline-block h-[2px] w-8 bg-[color:var(--amber)] align-middle" />
          Storefront
        </p>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-10 gap-y-8">
          <div className="min-w-0">
            <h1 className="rf-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.05] tracking-[-0.02em] text-t1">
              {work.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="pill border-verified/25 bg-verified-subtle text-[10px] font-semibold uppercase tracking-[0.12em] text-verified">
                <span className="h-1.5 w-1.5 rounded-full bg-verified" />
                Release live on {ACTIVE_CHAIN.name}
              </span>
              {work.work_contract && (
                <span className="rf-data text-xs text-t4">
                  work contract <Address value={work.work_contract} link />
                </span>
              )}
            </div>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-t3">
              Buy a copy of the finished work — every purchase splits on-chain with
              the whole team, automatically.
            </p>
          </div>

          {/* Buy panel */}
          <div className="w-full max-w-sm shrink-0 rounded-xl border border-[color:var(--border-subtle)] bg-surface p-6">
            <div className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">
              Price per copy
            </div>
            <div className="rf-display mt-2 text-4xl leading-none text-t1">
              {price} <span className="text-xl text-t3">USDG</span>
            </div>
            <PendingButton
              pending={buying}
              pendingLabel="Signing USDG payment…"
              onClick={buy}
              className="btn-sticker mt-5 w-full px-6 py-3 text-[13px] uppercase tracking-[0.08em]"
            >
              Buy copy with USDG
            </PendingButton>
            <p className="mt-3.5 text-[11px] leading-relaxed text-t4">
              On-chain split pays every contributor automatically · 3% Foundry fee.
            </p>
            {actionError && (
              <p className="mt-2 text-xs font-semibold text-danger">{actionError}</p>
            )}
          </div>
        </div>

        {/* Stat strip — hairline grid */}
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] sm:grid-cols-3">
          <HeroStat label="Copies sold" value={copiesSold} note="editions purchased" />
          <HeroStat label="Total revenue" value={totalRevenue.toFixed(2)} note="USDG collected" />
          <HeroStat
            label="Paid to creators"
            value={`~${paidToCreators.toFixed(2)}`}
            note="97% of revenue"
            tone="text-success"
          />
        </div>
      </section>

      {/* ============ ROYALTY SHARES ============ */}
      <section className="mt-16">
        <SectionHead
          eyebrow="Split of every sale"
          title="Royalty shares"
          aside={`${royaltyRows.length} recipients`}
        />
        <div className="mt-6 rounded-xl border border-[color:var(--border-subtle)] bg-surface p-6">
          <RoyaltyTable rows={royaltyRows} />
        </div>
      </section>

      {/* ============ AI PUBLISHING HUB ============ */}
      <section className="mt-16">
        <SectionHead
          eyebrow="Foundry intelligence compiler"
          title="AI publishing hub"
          aside="3 release formats"
        />

        {loadingPub ? (
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-surface px-5 py-6 text-sm text-t3">
            <Spinner /> Compiling release assets…
          </div>
        ) : pubAssets ? (
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] md:grid-cols-2 lg:grid-cols-3">
            <div className="bg-surface p-6">
              <span className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">
                Steam store copy
              </span>
              <p className="mt-3 whitespace-pre-line text-[13px] leading-relaxed text-t2">
                {pubAssets.steamCopy}
              </p>
            </div>

            <div className="bg-surface p-6">
              <span className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">
                Social thread promo
              </span>
              <div className="mt-3 space-y-3">
                {pubAssets.socialThread.map((tweet, idx) => (
                  <div
                    key={idx}
                    className="relative rounded-lg border border-[color:var(--border-subtle)] bg-surface-inset p-3.5 pr-16"
                  >
                    <span className="rf-data absolute right-3 top-3 text-[10px] uppercase tracking-[0.12em] text-t4">
                      Card {idx + 1}
                    </span>
                    <p className="text-[13px] leading-relaxed text-t2">{tweet}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-surface p-6">
              <span className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">
                Portfolio layout brief (Behance)
              </span>
              <p className="rf-data mt-3 whitespace-pre-wrap text-xs leading-relaxed text-t3">
                {pubAssets.portfolioBrief}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Sparkles className="h-7 w-7" />}
            title="No release assets yet."
            body="The publishing agent compiles Steam copy, social posts, and portfolio briefs once the work is sealed."
          />
        )}
      </section>

      {/* ============ EXTERNAL SALE BRIDGE ============ */}
      <section className="mt-16">
        <SectionHead
          eyebrow="Simulate off-chain purchase"
          title="External sale bridge"
          aside="Steam / app stores"
        />
        <BridgeCallout work={work} bounties={bounties} onBridged={loadSales} />
      </section>

      {/* ============ SALES LOG ============ */}
      <section className="mt-16 pb-6">
        <SectionHead
          eyebrow="Storefront activity"
          title="Recent sales payouts"
          aside={`${sales.length} recorded`}
        />
        {sales.length === 0 ? (
          <EmptyState
            icon={<Receipt className="h-7 w-7" />}
            title="No purchases yet."
            body="Every copy sold appears here with its on-chain payout transaction."
          />
        ) : (
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)]">
            {sales.map((s) => (
              <SaleRow key={s.id} sale={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const external = sale.source === "bridged_external";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-surface px-5 py-3.5">
      <div className="flex items-center gap-3">
        <span
          className={`pill text-[10px] font-semibold uppercase tracking-[0.1em] ${
            external
              ? "border-info/25 bg-info-subtle text-info"
              : "border-verified/25 bg-verified-subtle text-verified"
          }`}
        >
          {external ? "Bridged sale" : "Direct storefront"}
        </span>
        <span className="rf-data text-[13px] text-t2">
          {sale.quantity} {sale.quantity === 1 ? "copy" : "copies"} ·{" "}
          {sale.amount_eth.toFixed(2)} USDG
        </span>
      </div>
      {sale.tx_hash ? (
        <TxLink hash={sale.tx_hash} />
      ) : (
        <span className="rf-data text-xs text-t4">no tx</span>
      )}
    </div>
  );
}

function BridgeCallout({
  work,
  bounties,
  onBridged,
}: {
  work: Work;
  bounties: Bounty[];
  onBridged: () => void;
}) {
  const { address } = useIdentity();
  const minted = bounties.filter((b) => b.status === "minted" && b.claimed_by);
  const participants = minted
    .filter((b) => (b.revenue_percent ?? 0) > 0)
    .map((b) => ({ address: b.claimed_by!, role: b.role, percent: b.revenue_percent! }));

  const [receiptContract, setReceiptContract] = useState(work.asset_contract ?? "");
  const [receiptTokenId, setReceiptTokenId] = useState(minted[0]?.token_id ?? "");
  const [priceEth, setPriceEth] = useState(String(work.base_price_eth ?? "0.0001"));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function bridge() {
    if (pending) return;
    if (!receiptContract || !receiptTokenId) {
      setError("A receipt contract + token id is required (a token the signer owns).");
      return;
    }
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ txHash: string }>("/api/sales/bridge", {
        wallet: address,
        workId: work.id,
        receiptContract,
        receiptTokenId,
        priceEth,
        principalAddress: work.requester_addr,
        participants,
      });
      setDone(r.txHash);
      onBridged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bridge failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 space-y-4 rounded-xl border border-[color:var(--border-subtle)] bg-surface p-6">
      <p className="max-w-2xl text-[13px] leading-relaxed text-t3">
        Simulate an off-chain Steam/App store purchase. The bridge creates an
        on-chain split payout to pay all team members and the protocol fee.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label text-[10px] uppercase tracking-[0.12em]" htmlFor="bridge-contract">
            Receipt contract
          </label>
          <input
            id="bridge-contract"
            className="input rf-data text-xs"
            value={receiptContract}
            onChange={(e) => setReceiptContract(e.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label className="label text-[10px] uppercase tracking-[0.12em]" htmlFor="bridge-token">
            Token ID
          </label>
          <input
            id="bridge-token"
            className="input rf-data text-xs"
            value={receiptTokenId}
            onChange={(e) => setReceiptTokenId(e.target.value)}
            disabled={pending}
          />
        </div>
        <div>
          <label className="label text-[10px] uppercase tracking-[0.12em]" htmlFor="bridge-price">
            Price (USDG)
          </label>
          <input
            id="bridge-price"
            className="input rf-data text-xs"
            type="number"
            step="0.0001"
            value={priceEth}
            onChange={(e) => setPriceEth(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border-subtle)] pt-4">
        <p className="text-[11px] leading-relaxed text-t4">
          Royalty shares: Principal{" "}
          <span className="rf-data text-t3">{truncateAddress(work.requester_addr)}</span> +{" "}
          {participants.length} creator(s) + 3% fee.
        </p>
        <PendingButton
          pending={pending}
          pendingLabel="Bridging sale details…"
          onClick={bridge}
          className="btn-ghost"
        >
          Simulate Steam sale
        </PendingButton>
      </div>

      {error && <p className="text-xs font-semibold text-danger">{error}</p>}
      {done && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-verified">
          Bridged successfully! <TxLink hash={done}>view tx ↗</TxLink>
        </p>
      )}
    </div>
  );
}
