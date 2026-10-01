# Creator Foundry — Overview

This document explains **what Creator Foundry is and how it behaves for a person using it**.
For internals see [ARCHITECTURE.md](ARCHITECTURE.md); for the protocol rationale see
[WHITEPAPER.md](WHITEPAPER.md).

## The problem, stated plainly

Creative production runs on trust, and the trust breaks in both directions.

**For the contributor.** You finish a task and then wait for a producer to remember to pay you.
Payment is a favour performed after the work, not a condition of it. If the producer goes quiet,
the work is done and unpaid and there is no recourse. Attribution gets argued about after the
fact, royalty splits live in spreadsheets that only one person can see, and platforms routinely
take 30%.

**For the producer.** You front a brief and a budget, and nothing stops a claimant from taking the
reward without ever delivering. Approving early is a gamble; holding payment is the only defence
you have — which is exactly the behaviour that makes the first problem worse.

Both sides are behaving rationally inside a system with no enforcement. That is the actual bug.

## What Creator Foundry does

It replaces "pay after I remember" with **the reward is locked before the work starts, and
released by pre-agreed rules that neither party can unilaterally break**.

Four mechanisms do the work:

1. **AI planning.** A producer's idea is decomposed into scoped bounties — role, reward, written
   deliverable spec — plus a persistent creative memory (palette, characters, tone, audience) that
   every later judgement is grounded in.
2. **Escrowed rewards with two clocks.** The money and a hash of the brief go into a contract
   before work begins. The contributor gets a `deliveryWindow` to hand something in and the
   producer gets a `reviewWindow` to respond. Missing either window hands the outcome to the other
   party automatically.
3. **Proof of authorship + immutable royalties.** Approval mints an ERC-721 whose royalty receiver
   and payout table are committed on-chain. Contributors are paid by the contract on every sale,
   pro-rata, with no one to chase.
4. **A trained critic instead of a vibe.** Delivery quality is scored by a real model against the
   project's own art direction, and that score is written on-chain alongside the payment — so the
   review is citable rather than claimed.

## Who it's for

| Persona | What they get |
|---|---|
| **The producer** (indie studio, label, small publisher) | A budget that cannot leak, a reviewable trail of who delivered what, and no need to trust a contributor's promise or police them personally. |
| **The contributor** (concept artist, composer, writer, modeller) | Visible proof the money exists before starting, automatic payment on approval, and a fallback that pays them even if the producer disappears. |
| **The collector / customer** | Copies come with a transparent, publicly auditable split table, so "the creators get paid" is verifiable rather than a marketing line. |
| **The platform** | Takes a 3% fee that is one row in the same public table as everyone else, capped at 15% in the contract. |

## The end-to-end journey

### Act 1 — The producer opens a project

1. The producer connects a wallet. **The wallet address is the identity** — there is no account to
   create and no password to leak.
2. They describe the idea. The AI director returns a production plan: a title, a description, an
   inspiration board (mood keywords, colour swatches with hex values, typography, visual
   references, music mood, audience) and a set of suggested bounties.
3. They accept or edit the bounties. Each bounty carries a **role**, a **reward in USDG**, a
   **revenue share** (the royalty percentage the contributor earns on future sales) and a written
   spec.
4. The creative memory derived from the brief is stored on the work and used by every subsequent
   agent — the critic, the director chat, the story assistant — so advice is grounded in this
   project rather than generic.

### Act 2 — The money is locked

5. On a bounty, the producer clicks **Lock reward**. They choose the delivery and review windows
   (presets exist down to *5 minutes — live demo*). The app approves USDG if needed and calls
   `fund(key, amount, briefHash)`.
6. From that moment the reward is not a promise; it is a balance inside a contract, and the spec
   being paid for is fixed by hash. Changing the brief afterwards doesn't change what's owed.
7. The producer names the contributor (`assignContributor`), which starts both clocks.

### Act 3 — The contributor delivers

8. In the **Contributor Hub** the contributor sees the task with **"1.8 USDG locked"** shown
   *before* accepting. They claim it.
9. They upload the deliverable. The bytes are stored and hashed.
10. They sign `attestDelivery(key, deliveryHash)`. This is the contributor's own on-chain record of
    exactly what they handed over — the artifact can never be swapped later, and it starts the
    producer's review clock.

### Act 4 — Review and payout

11. The producer opens the deliverable and runs the **critic**. The Python service scores style
    consistency, palette match and technical quality against the project's palette plate.
12. The producer approves. A single flow:
    - mints the authorship NFT to the contributor with their royalty receiver and bps,
    - reads the real `tokenId` back out of the `AssetMinted` event,
    - calls `release(key, criticScore)`, paying the contributor,
    - stores both transaction hashes, the score and the artifact hashes, and writes them into the
      token's metadata.
13. The work can then be **sealed**: the immutable USDG payout table is committed, and the release
    NFT is minted. From here every copy sale pays every contributor automatically.

### Act 4′ — The producer never reviews (the important path)

14. If the producer goes silent past `reviewDeadline`, **anyone** — the contributor included — can
    call `autoRelease(key)` and the contributor is paid. No ticket, no support queue, no platform
    discretion.
15. If instead the contributor never delivers, the producer calls `refund(key)` after
    `deliveryDeadline` and gets the reward back. That path closes permanently the moment delivery is
    attested.

### Act 5 — The work earns

16. A customer buys a copy on the storefront with a browser-signed USDG transfer into the splits
    contract.
17. **Release to all contributors** (`splits.release()`) is permissionless. Each payee is credited
    by the contract; the **Withdraw** action transfers a payee's own balance out.
18. Contributors see their claimable revenue in the Contributor Hub, so they never depend on the
    producer's private dashboard to know what they're owed.

## Design principles we held to

- **Never show a number we can't defend.** On-chain actions that didn't happen are reported as
  simulated with a null hash, never as a plausible-looking fake transaction.
- **The contract is the arbiter.** Windows, splits and the fee cap are enforced in Solidity. The app
  is a convenience layer over rules it cannot bend.
- **Permissionless where it matters.** `autoRelease` and `splits.release()` have no owner gate, so a
  stalled human can never block a payout.
- **Verifiable by a stranger.** Every claim in the README resolves to a transaction or a read-only
  script that anyone can re-run.
- **Evaluable with zero setup.** No database to provision, no key needed, no paid service required to
  boot the app and walk the product.

## Glossary

| Term | Meaning |
|---|---|
| **Work** | A creative project: the producer's brief plus its bounties, assets and royalties. |
| **Bounty** | One scoped task inside a work — a role, a USDG reward, a revenue share and a written spec. |
| **Creative memory** | The structured art direction (palette, characters, locations, tone, audio) derived from the brief and reused by every agent. |
| **Brief hash** | `keccak` of the brief, committed at funding time, fixing what the reward is for. |
| **Delivery hash** | `keccak` of the delivered artifact, attested by the contributor on-chain. |
| **deliveryWindow / reviewWindow** | The contributor's deadline to hand in, and the producer's deadline to respond. |
| **autoRelease** | Permissionless payout after `reviewDeadline` — the contributor's backstop. |
| **Seal** | Committing the immutable USDG split table for a finished work and minting its release NFT. |
| **Splits contract** | The per-work USDG revenue distributor holding the payout table. |
| **Critic score** | 0–100 quality verdict from the trained model, written into the release transaction and the NFT metadata. |
| **USDG** | Paxos Global Dollar, the 6-decimal ERC-20 used for all settlement. |
| **Simulated** | An action taken with no chain write (no signer configured). Always reported as such with a null hash. |
