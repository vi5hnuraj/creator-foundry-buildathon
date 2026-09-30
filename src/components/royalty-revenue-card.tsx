"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { useIdentity } from "@/lib/use-identity";
import { ERC20_ABI } from "@/lib/chains";
import {
  SPLITS_ABI,
  SPLITS_CONTRACT_ADDRESS,
  USDG_CONTRACT_ADDRESS,
} from "@/lib/nft-contract";
import { formatUsdg } from "@/lib/usdg-payments";
import { TxLink } from "./data";
import { Spinner } from "./spinner";
import { Activity } from "lucide-react";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * REVENUE — what the split contract is actually holding, and what you can take.
 *
 * A copy purchase moves USDG INTO `CreatorFoundrySplits`; nothing is paid out
 * until someone calls `release()`, which is permissionless (anyone can trigger
 * the distribution), after which each payee withdraws their own share. This card
 * is that missing half: without it the royalty promise could only be invoked
 * from a script, so a buyer's USDG landed in the contract with no in-app way to
 * move it — the exact "the payment is coming next week" the product exists to
 * kill.
 *
 * Shared between the producer's work board (which also shows the split table)
 * and the contributor hub, because `/work/:id` is owner-only: a contributor
 * could otherwise never withdraw what they were credited.
 */
export function RoyaltyRevenueCard({
  sealed = true,
  hideWhenIdle = false,
  className = "",
}: {
  sealed?: boolean;
  hideWhenIdle?: boolean;
  /** Applied to the card itself so an owning section can space it without leaving a gap when the card hides. */
  className?: string;
}) {
  const { address, isConnected } = useIdentity();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const splits = SPLITS_CONTRACT_ADDRESS;
  const live = sealed && !!splits && splits !== ZERO_ADDRESS;

  const [held, setHeld] = useState<bigint | null>(null);
  const [mine, setMine] = useState<bigint | null>(null);
  const [paidOut, setPaidOut] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"release" | "withdraw" | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!live || !publicClient || !splits) return;
    try {
      const account = (address ?? ZERO_ADDRESS) as `0x${string}`;
      const [balance, claimable, total] = await Promise.all([
        publicClient.readContract({
          address: USDG_CONTRACT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [splits as `0x${string}`],
        }),
        publicClient.readContract({
          address: splits as `0x${string}`,
          abi: SPLITS_ABI,
          functionName: "pendingBalance",
          args: [account],
        }),
        publicClient.readContract({
          address: splits as `0x${string}`,
          abi: SPLITS_ABI,
          functionName: "totalReleased",
        }),
      ]);
      setHeld(balance);
      setMine(claimable);
      setPaidOut(total);
    } catch {
      /* a chain read failed — leave the last good numbers on screen */
    }
  }, [live, publicClient, address, splits]);

  useEffect(() => {
    void refresh();
    if (!live) return;
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh, live]);

  async function call(action: "release" | "withdraw") {
    if (!publicClient || !splits) return;
    setBusy(action);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: splits as `0x${string}`,
        abi: SPLITS_ABI,
        functionName: action,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(null);
    }
  }

  if (!live) return null;

  const holdsMoney = (held ?? 0n) > 0n;
  const idle = !holdsMoney && (mine ?? 0n) === 0n && (paidOut ?? 0n) === 0n;
  if (hideWhenIdle && idle) return null;

  return (
    <div className={`card p-5 ${className}`.trim()}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-success" />
          <h3 className="text-[15px] font-semibold text-t1">Revenue</h3>
        </div>
        <span className="pill rf-data text-[11px]">
          {held === null ? "reading chain…" : `${formatUsdg(held)} USDG held`}
        </span>
      </div>

      <div className="space-y-2.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-t3" title="USDG sitting in the split contract from copy sales">
            Copy sales in the split contract
          </span>
          <span className="rf-data shrink-0 font-semibold text-t1">
            {held === null ? "—" : `${formatUsdg(held)} USDG`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-t3">Your withdrawable share</span>
          <span className="rf-data shrink-0 font-semibold text-t1">
            {!isConnected ? "connect wallet" : mine === null ? "—" : `${formatUsdg(mine)} USDG`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-t3">Distributed to creators so far</span>
          <span className="rf-data shrink-0 font-semibold text-t1">
            {paidOut === null ? "—" : `${formatUsdg(paidOut)} USDG`}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[color:var(--border-subtle)] pt-3">
        <button
          className="btn-ghost px-3 py-1.5 text-[12px] font-semibold text-success disabled:opacity-40"
          disabled={!holdsMoney || busy !== null}
          onClick={() => call("release")}
          title="Permissionless: anyone can push a sale's USDG out to every payee on the committed table. A contributor never depends on the producer to run it."
        >
          {busy === "release" ? <><Spinner /> Releasing…</> : "Release to all contributors"}
        </button>
        <button
          className="btn-ghost px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          disabled={(mine ?? 0n) === 0n || busy !== null}
          onClick={() => call("withdraw")}
          title="Take your own share. Each payee withdraws for themselves — the contract never sends on your behalf."
        >
          {busy === "withdraw" ? <><Spinner /> Withdrawing…</> : `Withdraw${mine ? ` ${formatUsdg(mine)} USDG` : ""}`}
        </button>
        {txHash && <TxLink hash={txHash}>View transaction</TxLink>}
      </div>

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
      {!error && !holdsMoney && (
        <p className="mt-2 text-[11px] leading-relaxed text-t4">
          Every sale is split by the on-chain table, not by us — including the platform fee.
        </p>
      )}
    </div>
  );
}
