import type { ReactNode } from "react";
import { txUrl, addressUrl, nftUrl } from "@/lib/explorer";
import { truncateAddress } from "@/lib/use-identity";

/**
 * On-chain data primitives (DESIGN_SPEC): addresses, hashes, amounts always in
 * mono (.rf-data, tabular-nums). Tx/address links point to the active chain explorer (Arbiscan/Robinhood),
 * colored --info.
 */

/** Truncated address in mono; optionally links to Etherscan. */
export function Address({
  value,
  link,
}: {
  value: string | null | undefined;
  link?: boolean;
}) {
  if (!value) return <span className="rf-data text-t4">—</span>;
  if (link) {
    return (
      <a
        href={addressUrl(value)}
        target="_blank"
        rel="noreferrer"
        className="rf-data text-t3 transition-colors hover:text-info"
      >
        {truncateAddress(value)}
      </a>
    );
  }
  return <span className="rf-data text-t2">{truncateAddress(value)}</span>;
}

/** Etherscan tx link in mono. */
export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="rf-data text-info transition-colors hover:underline"
    >
      {children ?? "tx ↗"}
    </a>
  );
}

/** Etherscan NFT link (contract + token id) in mono. */
export function NftLink({
  contract,
  tokenId,
  children,
}: {
  contract: string;
  tokenId: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={nftUrl(contract, tokenId)}
      target="_blank"
      rel="noreferrer"
      className="rf-data text-info transition-colors hover:underline"
    >
      {children ?? "NFT ↗"}
    </a>
  );
}

/** USDG amount in mono. */
export function Amount({ eth }: { eth: number | string }) {
  return (
    <span className="rf-data">
      {eth} <span className="text-t3">USDG</span>
    </span>
  );
}
