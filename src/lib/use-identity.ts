"use client";

import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

/**
 * The single identity abstraction for the whole app. Screens use ONLY this —
 * never wagmi/RainbowKit hooks directly — so the wallet library stays swappable.
 *
 * The connected address merely identifies the user (producer / contributor / buyer).
 */
export type Identity = {
  address: string | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
};

export function useIdentity(): Identity {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  return {
    address: address ?? null,
    isConnected,
    connect: () => openConnectModal?.(),
    disconnect: () => disconnect(),
  };
}

/** Shorten an address for display: 0x1234…abcd. */
export function truncateAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
