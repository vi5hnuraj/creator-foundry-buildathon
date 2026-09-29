/**
 * Explorer links for the buildathon chains (FRONTEND_SPEC: link tx hashes / addresses).
 * Primary: Arbiscan Sepolia. Secondary: Robinhood Chain Blockscout explorer.
 */
import { ACTIVE_CHAIN } from "./chains";

const BASE = ACTIVE_CHAIN.blockExplorers.default.url;

export const txUrl = (hash: string) => `${BASE}/tx/${hash}`;
export const addressUrl = (addr: string) => `${BASE}/address/${addr}`;
export const nftUrl = (contract: string, tokenId: string) =>
  `${BASE}/token/${contract}?a=${tokenId}`;

/** Turn an ipfs:// ref into an HTTP gateway URL for <img> display. */
export function ipfsToHttp(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${ref.slice("ipfs://".length)}`;
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  return null;
}
