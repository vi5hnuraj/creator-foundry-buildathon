# HackQuest Submission — Creator Foundry

Everything below is copy-paste ready. Line 1 is what you paste into the submission form.

---

## Title

**Creator Foundry — get paid the moment your work is approved**

## One-line pitch

AI plans the production, a trained critic scores every delivery, and the reward is **locked in
escrow on-chain before the work starts** — so creators are paid the moment their work is
approved, and still get paid if the producer never reviews it.

## Problem

Creative work is paid on trust, and it breaks in both directions.

A contributor finishes a task and then waits on a producer to remember to sign a payment. If
that producer goes quiet, the work is done and unpaid, with no recourse. Attribution is argued
about after the fact, royalty splits live in spreadsheets, and platforms take 30%. Meanwhile
the producer's side is just as unprotected: they front a brief, and nothing stops a claimant
from taking the reward without delivering.

## Solution — how it works

1. **The producer opens a project.** An AI production director breaks the idea into bounties
   with roles, rewards and deliverable specs, keeping a persistent "creative memory" of the
   project's genre, palette and characters.
2. **The reward is locked before the work starts.** The producer funds
   `CreatorFoundryBountyEscrow` with USDG, which locks the brief's hash together with the money.
   From this moment the reward is not a promise — it is a balance in a contract.
3. **Contributors claim and deliver.** The contributor sees "1.8 USDG locked" on the task
   *before* accepting it.
4. **A trained AI critic scores the delivery** against the project's own palette and style guide
   (CLIP ViT-B/32 backbone + a trained scoring head) — style consistency, palette match and
   technical quality.
5. **The producer approves.** One approval mints an ERC-721 proof-of-authorship to the
   contributor (with ERC-2981 royalties) and releases the escrowed USDG in the same step. The
   critic's score and both artifact hashes are written into the token's metadata, so the review
   is citable rather than claimed.
6. **If the producer never reviews, the contributor still gets paid.** The escrow has two
   clocks: a delivery window (miss it with nothing delivered and the producer reclaims the
   reward) and a review window (miss it and *anyone* — including the contributor — can trigger
   `autoRelease`). Neither side has to trust the other, and neither side has to trust us.

## Why this is the interesting part

Most escrow designs use a single timer, which means a bad actor on either side can simply wait
the clock out and take the money. Creator Foundry uses **two independent windows**, both set by
the producer when the contributor is assigned:

| Window | Starts | If it expires |
|---|---|---|
| `deliveryWindow` | when the contributor is assigned | producer reclaims the reward (nothing was delivered) |
| `reviewWindow` | when the contributor attests a delivery on-chain | any address can `autoRelease` the payout to the contributor |

`release()` deliberately does **not** require the on-chain attestation — the producer is only
ever moving money *to* the contributor, so adding that requirement would only create a way for a
failed transaction to strand a legitimate payout.

## Verified on-chain (every link is a real transaction)

**Robinhood Chain Testnet (46630)**

| Contract | Address |
|---|---|
| `CreatorFoundryAssetNFT` (ERC-721 + ERC-2981) | `0xb176b9ea780c534c47c15a9651f7af1b80302b10` |
| `CreatorFoundryBountyEscrow` | `0x6390674fe1ac130c145299396a5441510d052062` |
| `CreatorFoundrySplits` (USDG splits) | `0x66ffff1d5bd5cd41e4cd9695875f1e8e96bdd845` |
| Paxos USDG (real, no mock) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |

One complete bounty loop, start to finish (`Concept Art – Inspector Vale Character Design`,
1.8 USDG):

| Step | Transaction |
|---|---|
| Reward locked in escrow (+ brief hash) | [`0x8c4aaff3…`](https://explorer.testnet.chain.robinhood.com/tx/0x8c4aaff3b0e3c1a6a1095845bfb910cc740b074795349e4fedb660ba0813ff3f) |
| Contributor named, SLA clocks started | [`0x8f7cc410…`](https://explorer.testnet.chain.robinhood.com/tx/0x8f7cc410037819926610a1e4a5ee9fdd4979d8fb9017e5c348c5adbab7234fca) |
| Authorship NFT minted to the contributor | [`0x5b1875a6…`](https://explorer.testnet.chain.robinhood.com/tx/0x5b1875a627ec98d7e2dff03404e2f115772fc348f0eadfa26636cd7f1a1b7437) |
| Escrow released — critic score 80 stamped on-chain | [`0x4f6c9be2…`](https://explorer.testnet.chain.robinhood.com/tx/0x4f6c9be2c727534017d6f4d07050da5d83472f4508a8f02f74cae395e0694afd) |

Read back from the chain afterwards: `released = true`, `criticScore = 80`, the contributor's
USDG balance went **0 → 1.8**, and `ownerOf(1)` is the contributor's wallet.

**And the royalty half, on the same deployment** — the `Neon Requiem` work sealed, sold and paid
out through the split:

| Step | Transaction |
|---|---|
| Work release NFT minted | [`0xb1f07f3f…`](https://explorer.testnet.chain.robinhood.com/tx/0xb1f07f3f465ff51fddb306042f09d4405862b766959b42b93084fbd7ee88f55f) |
| **Immutable USDG split table committed** | [`0x523fc989…`](https://explorer.testnet.chain.robinhood.com/tx/0x523fc9896a9f0090a1924a45358b8cf0f47df5b10c67d4fce168fc4d76a9fa1c) |
| A copy is bought (3 USDG into the split) | [`0xf90b5249…`](https://explorer.testnet.chain.robinhood.com/tx/0xf90b5249b7454c1c16b7f8797f369e709da235d448ac6ae281349a95d72b0d3d) |
| **`release()` pays every contributor pro-rata** | [`0x3e8fa360…`](https://explorer.testnet.chain.robinhood.com/tx/0x3e8fa360bad991c6d18fd940ea520b30dca121ef6972a543a6eba17e4ffd1c8a) |
| Producer withdraws their own share | [`0xa2b64e57…`](https://explorer.testnet.chain.robinhood.com/tx/0xa2b64e57b943366078d2d83d375d70ea976cd62ef39ced439398f0663c965323) |

Every contributor is credited by the contract — not by us — and the platform's 3% fee is one row
in the same public table, capped at 15% in the contract. `release()` is permissionless: a
contributor never depends on the producer to run it.

**Arbitrum Sepolia (421614)** — `CreatorFoundryAssetNFT` `0xd63401c8b86c5baa85e4af0e141c4bb55cf4f5ca`,
`CreatorFoundrySplits` `0x381f563514b264e7142bd3ea090e34350c0e6693`,
[`CreatorFoundryBountyEscrow`](https://sepolia.arbiscan.io/address/0x0a002725a40c46fcdbc7cca488f6469b8203ce96)
`0x0a002725a40c46fcdbc7cca488f6469b8203ce96` (deployed in
`0x33efe607…`, settles in that chain's USDG `0xFFC95faa…`).

## Tech stack

- **Solidity** — three contracts: proof-of-authorship ERC-721 + ERC-2981, a 0xSplits-style USDG
  revenue distributor with permissionless `release()`, and the two-sided bounty escrow.
- **Paxos USDG** — the settlement currency end to end: bounty payouts, escrow, and copy sales.
- **Python + PyTorch** — the trained critic service (FastAPI): frozen CLIP backbone plus a
  trained scoring head, with per-project palette plates so a submission is judged against that
  project's own style guide.
- **Next.js 14 + TypeScript, wagmi/viem, Supabase or a JSON fallback** — the app and its API layer.

## Chains

Primary demo chain: **Robinhood Chain Testnet** (an Arbitrum Orbit chain, 46630), where the full
bounty → escrow → critic → payout loop and a royalty sale were both executed for real.
All three contracts are **deployed on Arbitrum Sepolia (421614) as well** — same Solidity, chain
agnostic, with addresses recorded per chain in `contracts/deployments.json` so `NEXT_PUBLIC_CHAIN` switches
the whole contract set. `node scripts/verify-onchain.mjs` reports both deployments in section 8
and can be re-run by anyone without a key.

---

## Demo video script (~2 minutes, read out loud)

**0:00–0:15 — the problem**
> "Creative work is paid on trust. A contributor finishes the job, then waits for the producer to
> remember to pay them. If that producer goes quiet, the work is done and unpaid."

**0:15–0:35 — the project board**
Open the Neon Requiem project. Point at the bounty list.
> "A producer posts a brief here. The AI breaks it into bounties — a concept artist, a modeler, a
> composer — each with a role, a reward in USDG, and a written spec."

**0:35–0:55 — lock the money**
Click **🔒 Lock reward** on a task, choose the window, sign.
> "This is the part that changes everything. The reward isn't a promise any more — it goes into
> an escrow contract *before* anyone starts work. The contract stores a hash of the brief, so the
> spec being paid for is fixed at that moment."

**0:55–1:15 — the contributor's view**
Switch to the Contributor Hub.
> "The contributor sees the money is already locked before they accept the task. They deliver,
> and their wallet records a hash of exactly what they handed in."

**1:15–1:35 — the AI critic**
Back to the producer, click **Review Deliverable**, run the critic.
> "A trained critic scores the work against this project's own palette and style guide — not a
> generic model. That score gets written onto the blockchain with the payment, so the review is
> verifiable, not a claim."

**1:35–1:55 — the payout**
Click **Approve**.
> "One approval does two things: it mints an NFT proving who made this asset, and it releases the
> escrowed USDG to them. Here's the transaction — the contributor's balance goes from zero to 1.8
> USDG."

**1:55–2:15 — the guarantee**
> "And if I had just… never clicked Approve? The escrow doesn't need me. Each bounty has two
> clocks: a delivery window, so a producer can reclaim if nothing ever arrives, and a review
> window — after which *anyone* can trigger the payout. The contributor can pay themselves. That's
> the whole point: neither side has to trust the other, and neither side has to trust us."
