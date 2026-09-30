"use client";

import { useIdentity, truncateAddress } from "@/lib/use-identity";

/**
 * Connect / account control built on the useIdentity() wrapper only — no direct
 * RainbowKit/wagmi usage, so pages stay provider-neutral. Clicking "Connect"
 * opens the wallet modal (RainbowKit underneath, via the hook).
 */
export function ConnectWallet({ size = "md" }: { size?: "md" | "lg" }) {
  const { address, isConnected, connect, disconnect } = useIdentity();

  if (!isConnected || !address) {
    return (
      <button
        onClick={connect}
        className={size === "lg" ? "btn-primary px-6 py-3 text-base" : "btn-primary"}
      >
        Connect wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="pill rf-data text-t2" title={address}>
        <span className="h-2 w-2 rounded-pill bg-verified" />
        {truncateAddress(address)}
      </span>
      <div className="flex items-center gap-1.5 text-xs text-t4 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-verified" />
        Connected
      </div>
      <button onClick={disconnect} className="btn-ghost px-3 py-1.5 text-xs">
        Disconnect
      </button>
    </div>
  );
}
