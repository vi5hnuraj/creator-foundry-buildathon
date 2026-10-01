# Smart Contracts

Three Solidity contracts (0.8.26) powering Creator Foundry. All three are
**deployed on Arbitrum Sepolia** (the buildathon's home chain) and **Robinhood
Chain Testnet** (an Arbitrum Orbit chain) — addresses live in
[`deployments.json`](./deployments.json).

| Contract | Purpose |
| --- | --- |
| [`src/CreatorFoundryAssetNFT.sol`](./src/CreatorFoundryAssetNFT.sol) | **Proof-of-authorship NFTs.** Each approved bounty mints an ERC-721 whose metadata points at the delivered asset; the contributor is recorded as the ERC-2981 royalty receiver at mint time, so attribution and resale royalties are enforced on-chain. |
| [`src/CreatorFoundrySplits.sol`](./src/CreatorFoundrySplits.sol) | **Revenue splitting in USDG.** Sealing a work commits a participant table (principal, artist, musician, …); every USDG purchase of the work is released pro-rata to the team on-chain. |
| [`src/CreatorFoundryBountyEscrow.sol`](./src/CreatorFoundryBountyEscrow.sol) | **Bounty escrow.** The producer deposits USDG when the bounty opens — the reward is locked before work starts, released to the contributor on approval (or automatically when the review window expires). Contributors keep 100% of the reward; platform fees are taken elsewhere. |

## Deployments registry

`deployments.json` is the per-chain address registry, written by
`npm run deploy` and read by the app (`src/lib/chains.ts`). Switch chains with
`NEXT_PUBLIC_CHAIN` — no redeploys needed:

| Chain | Chain ID | Status |
| --- | --- | --- |
| `arbitrum-sepolia` | 421614 | **Buildathon home chain** — all three contracts deployed |
| `robinhood-testnet` | 46630 (Orbit) | Primary demo chain — full loop proven (escrow → score → payout → royalty sale in real USDG) |

## Deploying

```bash
# Requires DEPLOYER_PRIVATE_KEY + gas in .env.local (see docs/DEPLOYMENT.md)
npm run deploy           # deploys all three to NEXT_PUBLIC_CHAIN, updates deployments.json
npm run verify           # read-only on-chain verification of every registry entry
```

Compilation happens through the npm `solc` package (no Foundry install
required); `scripts/deploy.mjs` handles compilation, deployment and registry
writes.

## Testing

- **Read-only end-to-end check:** `npm run verify` — asserts deployed bytecode,
  registry consistency and the on-chain royalty/escrow wiring.
- **Interactive demo flows:** `npm run demo:escrow` (bounty escrow loop),
  `npm run demo:seal` (seal → sale → split).
