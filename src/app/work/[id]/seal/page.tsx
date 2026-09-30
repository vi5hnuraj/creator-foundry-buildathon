"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Work, Bounty } from "@/lib/supabase";
import type { FeeMode } from "@/lib/supabase";
// apiGet is used by the split-table fetch below.
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity, truncateAddress } from "@/lib/use-identity";
import {
  computeSplitPreview,
  FORGE_FEE_PERCENT,
  type RoyaltyRow,
} from "@/lib/split-math";
import { RequireWallet } from "@/components/require-wallet";
import { RoyaltyTable } from "@/components/royalty-table";
import { Spinner } from "@/components/spinner";
import { TxPending } from "@/components/tx-pending";
import { Select } from "@/components/select";
import { FileInput } from "@/components/file-input";
import type { RoyaltySplitRecommendation } from "@/lib/services/ai";
import { NFT_CONTRACT_ADDRESS, NFT_ABI } from "@/lib/nft-contract";
import { commitSplitOnChain } from "@/lib/usdg-payments";
import { useWriteContract } from "wagmi";

type Board = { work: Work; bounties: Bounty[] };
type BreakdownRow = {
  address: string;
  role: string;
  percentOfWork: number;
  onchainRatio: number;
};

const SEAL_STEPS = [
  "Foundry AI: Compiling creative briefs & design memory digests...",
  "Foundry AI: Generating Steam copy and social media threads...",
  "Foundry AI: Structuring contribution royalty share ratios...",
  "Blockchain: Deploying Arbitrum ERC-2981 royalty contract...",
  "Blockchain: Setting up lazy-minting distribution rules...",
];

export default function SealPage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <SealInner workId={params.id} />
    </RequireWallet>
  );
}

function SealInner({ workId }: { workId: string }) {
  const { address } = useIdentity();
  const { writeContractAsync } = useWriteContract();

  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [basePriceEth, setBasePriceEth] = useState("0.0001");
  const [feeMode, setFeeMode] = useState<FeeMode>("absorb");
  const [cover, setCover] = useState<File | null>(null);

  const [sealing, setSealing] = useState(false);
  const [sealStepIndex, setSealStepIndex] = useState(0);
  const [sealError, setSealError] = useState<string | null>(null);
  const [result, setResult] = useState<BreakdownRow[] | null>(null);
  const [sealTxHash, setSealTxHash] = useState<string | null>(null);

  // CCI States
  const [aiRecs, setAiRecs] = useState<RoyaltySplitRecommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [savingRecs, setSavingRecs] = useState(false);
  const [editedSplits, setEditedSplits] = useState<Record<string, number>>({});

  const loadRecs = useCallback(async () => {
    setLoadingRecs(true);
    try {
      const data = await apiGet<{ recommendations: RoyaltySplitRecommendation[] }>(
        `/api/ai/contribution?workId=${workId}`
      );
      setAiRecs(data.recommendations);
      
      // Initialize edit splits inputs
      const initial: Record<string, number> = {};
      data.recommendations.forEach((r) => {
        initial[r.address] = r.recommendedPercent;
      });
      setEditedSplits(initial);
    } catch (e) {
      console.error("Failed to load split recommendations", e);
    } finally {
      setLoadingRecs(false);
    }
  }, [workId]);

  const load = useCallback(async () => {
    try {
      const b = await apiGet<Board>(`/api/works/${workId}`);
      setBoard(b);
      await loadRecs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work");
    } finally {
      setLoading(false);
    }
  }, [workId, loadRecs]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-t3">
        <Spinner /> Loading seal configurations…
      </div>
    );
  }
  if (error || !board) {
    return <div className="card bg-danger-subtle text-danger">{error ?? "Not found"}</div>;
  }

  const { work, bounties } = board;
  const isProducer = address?.toLowerCase() === work.requester_addr.toLowerCase();

  if (!isProducer) {
    return (
      <div className="card text-t3">
        Only the producer can seal this work.{" "}
        <Link href={`/work/${work.slug || work.id}`} className="text-accent font-semibold">
          Back to board
        </Link>
      </div>
    );
  }
  if (work.status === "sealed") {
    return (
      <div className="card max-w-xl mx-auto text-center py-8 space-y-4">
        <svg className="w-10 h-10 mx-auto text-verified" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <h2 className="text-2xl font-bold text-t1">This work is already sealed</h2>
        <p className="text-sm text-t3">The release settings and split payouts are active on Arbitrum.</p>
        <Link href={`/work/${work.slug || work.id}/store`} className="btn-primary mt-4 inline-block">
          Go to storefront ↗
        </Link>
      </div>
    );
  }

  const assigned = bounties.filter((b) => (b.revenue_percent ?? 0) > 0);
  const minted = assigned.filter((b) => b.status === "minted" && b.claimed_by);
  const preview = computeSplitPreview(minted.map((b) => b.revenue_percent!));
  const ratioByBounty = new Map<string, number>();
  minted.forEach((b, i) => ratioByBounty.set(b.id, preview.participantRatios[i]));

  const grossPrice =
    feeMode === "passthrough"
      ? (Number(basePriceEth) / (1 - FORGE_FEE_PERCENT / 100)).toFixed(6)
      : basePriceEth;

  async function applyAiSplits() {
    setSavingRecs(true);
    try {
      const splitPayload = Object.keys(editedSplits).map((addr) => ({
        address: addr,
        percent: editedSplits[addr],
      }));
      await apiPost("/api/ai/contribution", {
        workId,
        splits: splitPayload,
        wallet: address,
      });
      // Reload page state to recalculate preview splits
      const b = await apiGet<Board>(`/api/works/${workId}`);
      setBoard(b);
      alert("AI recommendations applied and saved to deliverables!");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to apply splits");
    } finally {
      setSavingRecs(false);
    }
  }

  function handleEditSplit(addr: string, val: number) {
    setEditedSplits({
      ...editedSplits,
      [addr]: val,
    });
  }

  async function seal() {
    if (sealing) return;
    if (!cover) {
      setSealError("Upload a cover image for the work release.");
      return;
    }
    if (minted.length === 0) {
      setSealError("Mint at least one asset before sealing.");
      return;
    }
    setSealing(true);
    setSealStepIndex(0);
    setSealError(null);

    const interval = setInterval(() => {
      setSealStepIndex((prev) => (prev < SEAL_STEPS.length - 1 ? prev + 1 : prev));
    }, 1500);

    try {
      const { path } = await apiUpload(cover);

      // Wallet-signed work NFT mint — MetaMask opens. The producer is the
      // royalty receiver for the published work (5% resale royalty).
      let txHash: string | undefined;
      if (NFT_CONTRACT_ADDRESS && NFT_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
        const uri = `${window.location.origin}/api/metadata/work/${workId}`;
        txHash = await writeContractAsync({
          address: NFT_CONTRACT_ADDRESS,
          abi: NFT_ABI,
          functionName: "mint",
          args: [address as `0x${string}`, uri, address as `0x${string}`, 500n],
        });
        setSealTxHash(txHash);
      }

      // COMMIT THE REVENUE SPLIT ON-CHAIN. This is the step the storefront
      // depends on: until commitSplit runs, the splits contract is uncommitted,
      // release() can only revert, and a copy purchase would take the buyer's
      // USDG with no way to distribute it. The table comes from the server so
      // the on-chain weights match buildRevenueSplit exactly (including merging
      // the fee row when the fee wallet is the principal).
      const table = await apiGet<{
        payees: string[];
        weights: number[];
        feeBps: number;
        splitsContract: string | null;
        breakdown: BreakdownRow[];
      }>(`/api/works/${workId}/split`);

      let splitsTxHash: string | undefined;
      if (table.splitsContract) {
        setSealStepIndex(3);
        splitsTxHash = await commitSplitOnChain(writeContractAsync, {
          splitsContract: table.splitsContract,
          payees: table.payees,
          weights: table.weights,
          feeBps: table.feeBps,
        });
      }

      // Record the sealed state (metadata only — the signatures happened above)
      await apiPost(`/api/works/${workId}/seal`, {
        basePriceEth: Number(basePriceEth),
        feeMode,
        imagePath: path,
        wallet: address,
        txHash: txHash || undefined,
        splitsTxHash: splitsTxHash || undefined,
      });

      clearInterval(interval);
      setSealStepIndex(SEAL_STEPS.length - 1);
      // Show the table that was actually committed, not an empty list.
      setResult(table.breakdown ?? []);
    } catch (e) {
      clearInterval(interval);
      setSealError(e instanceof Error ? e.message : "Seal failed");
      setSealing(false);
    }
  }

  if (result) {
    const rows: RoyaltyRow[] = result.map((r) => ({
      role: r.role,
      address: r.role === "platform_fee" ? "" : r.address,
      ratio: r.onchainRatio,
      assigned: r.percentOfWork,
      tint: r.role === "platform_fee" ? "info" : undefined,
    }));
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="rf-display text-3xl font-extrabold">
          Work <span className="rf-prism-text">Sealed</span>
        </h1>
        <p className="mt-1 text-sm text-t3">
          The release is live on Arbitrum. Every copy sold pays this royalty share automatically.
        </p>
        <div className="card mt-6 shadow-glow-prism">
          <SplitPanelHeader />
          <RoyaltyTable rows={rows} />
        </div>
        <Link href={`/work/${work.slug || work.id}/store`} className="btn-primary mt-6 shadow-glow-accent">
          Go to storefront ↗
        </Link>
      </div>
    );
  }

  const previewRows: RoyaltyRow[] = [
    {
      role: "principal",
      address: work.requester_addr,
      ratio: preview.principalRatio,
      assigned: preview.principalPercent,
    },
    ...assigned.map((b) => ({
      role: b.role,
      address: b.claimed_by ?? "",
      ratio: ratioByBounty.has(b.id) ? ratioByBounty.get(b.id)! : null,
      assigned: b.revenue_percent ?? 0,
      dim: !ratioByBounty.has(b.id),
    })),
    {
      role: "platform_fee",
      address: "",
      ratio: preview.feePercent,
      tint: "info" as const,
    },
  ];

  return (
    <div>
      <Link href={`/work/${work.id}`} className="text-xs text-t3 hover:text-t2 font-semibold">
        ← Back to {work.title}
      </Link>
      
      <h1 className="mt-3 rf-display text-3xl font-extrabold">Seal Project Release</h1>
      <p className="text-sm text-t3">
        Configure the copy-sale storefront. The royalty share is calculated by Foundry and baked directly into the smart contract.
      </p>

      {/* Dynamic Agent Card for CCI */}
      <div className="mt-6 space-y-4">
        {/* CCI — compact horizontal layout */}
        <div className="rounded-xl border border-info/20 bg-info-subtle/10 p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-bold text-t1 flex items-center gap-1.5 shrink-0">
              ⚖️ CCI <span className="text-[10px] text-info font-semibold hidden sm:inline">· Foundry Royalty Recommendation</span>
            </h2>
            {aiRecs.length > 0 && !loadingRecs && (
              <button onClick={applyAiSplits} disabled={savingRecs} className="text-[10px] btn-ghost px-2 py-1 bg-white/5 border border-white/10 font-semibold hover:bg-white/10 shrink-0">
                {savingRecs ? <Spinner /> : "Apply AI Splits"}
              </button>
            )}
          </div>
          {loadingRecs ? (
            <div className="text-[10px] text-t3 mt-2"><Spinner /> Analyzing contributions...</div>
          ) : aiRecs.length === 0 ? (
            <div className="text-[10px] text-t4 mt-2">No minted assets to analyze. Complete and approve bounties first.</div>
          ) : (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {aiRecs.map((rec, idx) => (
                <div key={idx} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono text-t1 font-bold block truncate">{truncateAddress(rec.address)}</span>
                    <span className="text-[8px] text-t4 block truncate">{rec.reasoning.slice(0, 60)}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <input type="number" min="0" max="100" className="bg-transparent border border-white/10 rounded px-1 py-0.5 text-center text-[10px] text-t2 font-bold w-10" value={editedSplits[rec.address] ?? rec.recommendedPercent} onChange={(e) => handleEditSplit(rec.address, Number(e.target.value))} />
                    <span className="text-[10px] font-bold text-t1">%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Settings + Royalty Preview — side by side */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
            <h3 className="text-xs font-bold text-t1">Sale Settings</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-t4 font-semibold block mb-1" htmlFor="price">Price (USDG)</label>
                <input id="price" className="input text-xs py-1.5" type="number" step="0.0001" min="0" value={basePriceEth} onChange={(e) => setBasePriceEth(e.target.value)} disabled={sealing} />
              </div>
              <div>
                <label className="text-[10px] text-t4 font-semibold block mb-1" htmlFor="fee">Fee Mode</label>
                <Select id="fee" value={feeMode} onChange={(e) => setFeeMode(e.target.value as FeeMode)} disabled={sealing} className="text-xs py-1.5">
                  <option value="absorb">Creator absorbs</option>
                  <option value="passthrough">Buyer pays</option>
                </Select>
              </div>
            </div>
            <p className="text-[9px] text-t4 leading-relaxed">
              {feeMode === "passthrough"
                ? <>Buyer pays ~<span className="text-accent font-semibold">{grossPrice} USDG</span>. Creators net full amount.</>
                : "3% protocol fee deducted from base price."}
            </p>
            <div>
              <label className="text-[10px] text-t4 font-semibold block mb-1">Cover Art</label>
              <FileInput accept="image/*" disabled={sealing} onChange={setCover} label="Choose image" />
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <SplitPanelHeader />
            <div className="mt-2">
              <RoyaltyTable rows={previewRows} />
            </div>
            <p className="mt-3 text-[9px] text-t4">*Shares sum to 97% — 3% reserved for platform fee.</p>
          </div>
        </div>
      </div>

      {sealError && <p className="mt-4 text-xs text-danger font-semibold">{sealError}</p>}

      {sealing ? (
        <div className="mt-6">
          <TxPending
            title="Foundry AI &amp; Blockchain Publishing Pipeline…"
            steps={SEAL_STEPS.map((step, idx) => {
              if (idx < sealStepIndex) return `✓ ${step}`;
              if (idx === sealStepIndex) return `➔ ${step}`;
              return `  ${step}`;
            })}
          />
        </div>
      ) : (
        <button className="btn-primary mt-6 shadow-glow-accent" onClick={seal}>
          Confirm Royalty Shares &amp; Deploy Release ↗
        </button>
      )}
    </div>
  );
}

function SplitPanelHeader() {
  return (
    <>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="rf-eyebrow">Royalty Shares</span>
        <span className="text-[10px] text-t4">Ethereum royalty configuration</span>
      </div>
      <hr className="rf-prism-rule mb-3" />
    </>
  );
}
