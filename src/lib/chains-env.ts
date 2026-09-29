/** Shared public env for chain config (kept separate so lib/chains.ts stays browser-safe). */
export const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID || "creator-foundry-dev-placeholder";
