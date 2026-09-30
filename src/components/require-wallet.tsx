"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useIdentity } from "@/lib/use-identity";
import { ConnectWallet } from "./connect-wallet";

/**
 * Gates a screen behind a connected wallet (the address is the user's identity).
 * The mounted check avoids a hydration flash since wallet state is client-only.
 */
export function RequireWallet({ children }: { children: ReactNode }) {
  const { isConnected } = useIdentity();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (!isConnected) {
    return (
      <div className="card mx-auto mt-16 max-w-md text-center p-8">
        <h2 className="text-lg font-semibold text-t1">Connect your wallet</h2>
        <p className="mt-1.5 text-sm text-t3">
          Your address identifies you across works, bounties, and sales.
        </p>
        <div className="mt-5 flex justify-center">
          <ConnectWallet />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
