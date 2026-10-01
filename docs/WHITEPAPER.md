# Creator Foundry — Whitepaper

**Escrowed, machine-scored creative production with immutable royalty distribution on Arbitrum.**

Version 1.0 · September 2026 · Arbitrum Open House Singapore, Online Buildathon

---

## Abstract

Creative work is commissioned before it exists and paid after it is judged, which makes every
transaction a bet on the other party's continued good faith. Creator Foundry removes that bet with
three mechanisms: a **bounty escrow with two independent deadlines**, so neither party can profit
by going silent; a **trained critic** whose score is committed on-chain alongside the payment, so
review is evidence rather than assertion; and a **one-shot revenue split table**, so the promise
that contributors share in future sales is enforced by code rather than by paperwork.

The system settles in **Paxos USDG** and runs on Arbitrum. A complete cycle — brief, escrow,
delivery, attestation, AI review, NFT mint, payout, copy sale, pro-rata royalty release — has been
executed on-chain with real tokens, and every step is independently verifiable without a private
key.

---

## 1. The problem

Creative production has an asymmetry that no amount of goodwill fixes.

A contributor performs work whose value cannot be assessed until it is complete. Payment therefore
arrives after delivery and after approval, which means the contributor carries the entire risk of
the producer's attention, solvency and honesty. Producers, symmetrically, must pay for work they
have not seen from a person they may not know; their only defence is delay, which reproduces the
first problem. Platforms absorb some of this by taking custody and a large cut — 30% is ordinary —
in exchange for becoming the arbiter.

Three failure modes recur:

1. **Non-payment by silence.** The work is complete, the producer stops responding, and there is no
   recourse that costs less than the debt.
2. **Submission without delivery.** A reward is claimed and nothing adequate arrives; the producer's
   remedy is to withhold payment, which recreates (1).
3. **Unverifiable review.** Quality claims, and the attribution and royalty arrangements that follow
   from them, live in private documents. Contributors cannot audit what they are owed; buyers cannot
   audit who was paid.

Existing tools treat each half separately. Escrow solves custody but not judgement. Royalty
splitters solve distribution but not commissioning. Dispute-resolution systems solve conflict — at
the cost of a judge, which reintroduces the trust the design was meant to remove.

## 2. Design goals and non-goals

**Goals**

- A reward that is visibly and enforceably committed **before** work begins.
- A completion path that does **not** require the counterparty to act in good faith *or even to
  act at all*.
- Review that is attributable: a specific model produced a specific score.
- Royalty distribution that is immutable, permissionless to trigger, and publicly auditable.
- Zero-configuration evaluability: anyone can clone and run the whole system with no database, no
  API keys and no funding.

**Non-goals**

- **Not a dispute court.** We do not adjudicate quality. Deadlines are made automatically decisive
  precisely so that no arbiter is needed.
- **Not a marketplace for finished goods.** The storefront exists to demonstrate royalty
  distribution, not to compete on discovery.
- **Not upgradeable.** Contracts are immutable and unproxied. That is a deliberate product promise,
  not a technical limitation.
- **Not a token project.** There is no protocol token, no emissions and no governance theatre.

## 3. System overview

```
Producer ──brief──▶ AI director ──bounties──▶ Producer funds escrow
                                                    │
                                                    ▼
                              CreatorFoundryBountyEscrow   (USDG + briefHash)
                                                    │
Contributor ◀──sees locked amount──  claim + deliver + attestDelivery(deliveryHash)
                                                    │
                                                    ▼
                                      trained critic ──▶ score 0–100
                                                    │
Producer ──approve──▶ CreatorFoundryAssetNFT.mint(...)  +  escrow.release(key, score)
                                                    │
                       ┌────────────────────────────┴────────────────────────────┐
                       ▼                                                          ▼
        reviewDeadline passes → autoRelease()              producer seals the work
        (permissionless, pays the contributor)             CreatorFoundrySplits.commitSplit(...)
                                                                                  │
                                                        buyer ──USDG──▶ splits.release()
                                                        (permissionless, pro-rata to every payee)
```

## 4. The escrow protocol

Each bounty gets one escrow, addressed by `keyFor(bountyId) = keccak256(bountyId)`.

### 4.1 State machine

```
        fund(key, amount, briefHash)
                 │
                 ▼
          ┌─────────────┐   assignContributor(key, contributor, dWin, rWin)
          │   FUNDED    │──────────────────────────────────────────────┐
          │ (no clocks) │                                              │
          └─────────────┘                                              ▼
                 │                                            ┌──────────────┐
                 │ refund() before assignment                 │  ASSIGNED    │
                 │                                            │ deliveryDead │
                 ▼                                            │ reviewDead(0)│          ┌─────────────┐                                     └──────┬───────┘
          │  REFUNDED   │                                            │
          └──────┬──────┘                          attestDelivery(key, deliveryHash)
                 │                                                  │
                 │ fund() again on the same key: the bounty          ▼
                 │ reopens for a new contributor            ┌──────────────────┐
                 └─────────────────────────────────────────▶│    ATTESTED      │
                 ▲                                          │ deliveryDead      │
                 │  refund() after deliveryDeadline,        │ reviewDeadline   │
                 └── ONLY while not attested ───────────────│                  │
                                                            └────┬────────┬────┘
                                                    release()    │        │  autoRelease()
                                                    (producer)   │        │  (ANYONE, after
                                                                 ▼        ▼   reviewDeadline)
                                                            ┌──────────────────┐
                                                            │    RELEASED      │
                                                            │ criticScore set │
                                                            └──────────────────┘
```

`RELEASED` is terminal. `REFUNDED` is not: the escrow flags `refunded = true` and the same key can
be funded again, so an expired bounty reopens for another contributor. Re-funding a *paid* escrow is
rejected — otherwise one delivery could be paid twice.

### 4.2 Windows

The producer sets `deliveryWindow` and `reviewWindow` at assignment. Both are bounded in-contract:
`MIN_WINDOW = 5 minutes`, `MAX_WINDOW = 90 days`, enforced by `InvalidWindow`.

- `deliveryDeadline = now + deliveryWindow` — the contributor must `attestDelivery` before it.
- `reviewDeadline` starts at **0** and is set to `now + reviewWindow` **when delivery is attested**.

The two clocks are what make silence unprofitable:

| Actor | Strategy | Outcome |
|---|---|---|
| Producer stalls | ignores the delivery | after `reviewDeadline`, anyone calls `autoRelease()`; contributor is paid |
| Contributor stalls | never delivers | after `deliveryDeadline`, producer calls `refund()`; reward returns |
| Producer stalls *after* funding, before assigning | — | producer may `refund()`; no contributor is harmed |
| Either party tries to reverse | producer attempts refund after attestation | reverted by `AlreadyAttested` |

### 4.3 Why `release()` does not require attestation

It is tempting to require `attested == true` before `release()`. We deliberately do not: the
producer's `release()` moves money only *toward* the contributor, so requiring the attestation adds
no protection against the only actor it could protect against (the producer), and it introduces a
failure mode where a legitimate payout is blocked by a transaction the contributor failed to land.
Safety here is directional, and the direction is unambiguous. `refund()`, which moves money *away*
from the contributor, is the call that demands the attestation check — and gets it.

### 4.4 Invariants

| Invariant | Enforcement |
|---|---|
| One escrow per bounty; funded once | `AlreadyFunded`, `NotFunded` |
| Only the producer funds, assigns, releases, refunds | `NotProducer` |
| Only the named contributor attests | `NotContributor`, `ContributorUnset` |
| Assignment is unique and irreversible | `ContributorAlreadySet` |
| Refund cannot race a delivery | `DeliveryWindowOpen`, `AlreadyAttested` |
| Auto-release cannot fire early or undelivered | `ReviewWindowOpen`, `NotAttested` |
| No double payout, and no re-funding of a paid escrow | `AlreadyReleased`, `AlreadyFunded` unless `refunded` |
| A refunded bounty can reopen for a new contributor | `fund()` permitted again once `refunded` |
| No stuck native currency | `EthNotAccepted` |
| Reentrancy-safe value movement | `ReentrancyGuard`, `TokenTransferFailed` |

## 5. Revenue split protocol

A finished work's payouts are committed once, permanently, in a per-work `CreatorFoundrySplits`
instance.

### 5.1 Weights and the fee

The producer assigns each contributor a **percentage of the work**; the producer keeps the
remainder. The platform fee is inserted *underneath* that model by scaling the creator side into a
`(100 − fee)` pot, so an author's stated share is a share of the *creator pot*, not of gross.

- `DEFAULT_FEE_BPS = 300` (3%), `MAX_FEE_BPS = 1_500` (15%) — `FeeTooHigh` enforces the cap on-chain.
- All on-chain weights are integers; `commitSplit` requires them to sum to exactly 10,000 with no
  duplicate payees (`WeightsExceedTotal`, `DuplicatePayee`).
- Rounding remainder always goes to the principal, and any contributor with a positive share
  receives at least one unit — so a small collaborator is never rounded to nothing.
- Rows for the same address are consolidated before submission, including the common case where the
  fee wallet is also the principal.
- `feeBps` describes the **rate**, not the weight of the fee row. Deriving it from the row produced
  a value far above the cap whenever fee wallet and principal shared an address, reverting
  `commitSplit` — a bug found in testing and fixed at the single source of truth.

### 5.2 Distribution

`release()` is **permissionless**. It divides the instance's balance pro-rata by committed weight
and credits each payee; `withdraw()` / `withdrawTo()` move a payee's own balance out, and
`pendingBalance(address)` reports it. No owner action is required to trigger a payout, so a stalled
platform or an absent producer cannot strand contributor revenue — the property that makes the
royalty claim credible rather than aspirational.

### 5.3 Why one instance per work

`commitSplit` is one-shot (`AlreadyCommitted`). A payout table that could be edited after publication
would make every royalty promise revocable, which is exactly the state of affairs this project
exists to replace. The cost is operational — each sealed work needs its own instance — and we accept
it without reservation.

### 5.4 Pricing modes

Two modes let the producer decide who absorbs the 3%:

- **absorb** — the buyer pays the base price; the fee comes out of the split (creators receive
  `base × 0.97`).
- **passthrough** — the on-chain price is raised by `1 / (1 − fee)` so the creator pot equals the
  stated base price exactly.

## 6. Proof of authorship and the on-chain review record

Approval performs two writes that belong together:

1. `CreatorFoundryAssetNFT.mint(to, uri, royaltyReceiver, royaltyBps)` — an ERC-721 with ERC-2981
   royalties, where the contributor is the royalty receiver. The app reads the authoritative
   `tokenId` out of the `AssetMinted` event rather than predicting it, so a minted record can never
   reference the wrong token.
2. `escrow.release(key, criticScore)` — pays the contributor and stamps the AI score into the
   release event.

Both artifact hashes are already on-chain by this point: the **brief hash** at funding time, which
fixes what was being paid for, and the **delivery hash** at attestation, which fixes what was
handed over. Token metadata then carries the brief hash, delivery hash, release transaction, escrow
kind and critic score together, with the review attached to the asset rather than filed elsewhere.

The consequence is that "was this reviewed, by what, and against which brief?" is answerable from
chain state alone.

## 7. The AI critic

Quality adjudication is the part of creative work most often hand-waved. We make it reproducible.

- **Frozen CLIP ViT-B/32 backbone** produces a 512-dimensional embedding of the candidate.
- A small **trained MLP head** (`critic_head.pt`) regresses from those embeddings to three
  independent signals: `style_score` (0–100), `palette_match` (0–1) and `quality` (0–100).
- **Per-project palette plates** are built from the project's creative memory, so a delivery is
  judged against *that project's* art direction rather than a generic aesthetic prior.
- Training data is **synthetic and controlled** — distortions with known labels — so there is no
  dataset-licensing problem and the model trains in about a minute on a laptop.
- The published score is `0.6 · style + 0.4 · quality`, and the model identity is recorded with it.

**Why not an LLM judge.** An LLM verdict is neither reproducible nor attributable: the same input
yields different scores across versions and sampling settings, so a score written on-chain would be
decorative. A deterministic regressor gives the same inputs the same score every time, which is what
makes the on-chain record evidence.

**Why the project's own palette.** A universally "good" aesthetic score would punish stylistically
coherent work that simply isn't conventional. Scoring relative to the brief's own declared palette
matches how an art director actually reviews.

## 8. Economic model

| Flow | Amount | Destination |
|---|---|---|
| Bounty reward | producer-set, per bounty | contributor, via escrow on approval or auto-release |
| Platform fee | 3% of each copy sale (cap 15%, on-chain) | one row in the same public split table |
| Contributor royalties | producer-assigned % of the creator pot | contributors, on every copy sale, pro-rata |
| Copy price | producer-set in USDG | splits contract, then distributed by weight |

The fee is a row in the same table as the creators, not a hidden deduction, and the cap is enforced
by the contract rather than by policy. Contributors see their claimable balance in the product and
can withdraw without asking anyone.

There is no token, no emission and no staking. Value flows only where work did.

## 9. Trust model and threat analysis

| Threat | Mitigation |
|---|---|
| Producer never reviews | `autoRelease()` after `reviewDeadline` — permissionless, needs no cooperation |
| Producer never assigns | `refund()` before assignment; the contributor was never exposed |
| Producer attempts to claw back after delivery | `refund()` reverts once `attested` (`AlreadyAttested`) |
| Contributor takes the reward without delivering | payment requires `release()` or `autoRelease()`, and `autoRelease()` requires attestation |
| Contributor substitutes the artifact later | the delivery hash is attested on-chain; the artifact referenced by metadata can't be swapped silently |
| Either party tries to make the other wait forever | both windows are bounded (`MIN_WINDOW`, `MAX_WINDOW`) |
| Platform raises its cut retroactively | capped at `MAX_FEE_BPS = 1_500` in the contract; committed tables are immutable |
| Platform refuses to release royalties | `splits.release()` is permissionless |
| Duplicate or malicious payee rows | `DuplicatePayee`, `ZeroAddress`, `EmptySplit` on-chain, plus consolidation in the split builder |
| Rounding to steal fractions | integer weights summing to 10,000, sub-1% floors, remainder to the principal — all visible in the committed table |
| Reentrancy on value transfer | `ReentrancyGuard` on every value-moving path |
| Fake off-chain "transaction" records | the application never fabricates a hash; unwritten actions are reported as simulated with a null hash |
| Model verdict fabricated by the app | a score always carries its model identity, and an unreachable critic is reported as a fallback, never disguised |
| Anyone mints an NFT claiming false authorship | `mint()` is deliberately permissionless — there is no platform key that could be stolen or abused, and every app mint is signed by the producer's own wallet. Impact is limited to metadata spam: an attacker can only mint to addresses they choose, at their own gas cost, and cannot touch escrowed funds or rewrite a committed split table |
| Spoofed off-chain API calls (no session auth) | the API layer carries bookkeeping only — status flags, critic runs, records. Every value-moving action (`fund`, `commitSplit`, `release`, `mint`, `withdraw`) is a wallet-signed transaction from the connected account; the server holds no signing key (`FORGE_PRIVATE_KEY` unset ⇒ all server paths report `simulated` with a null hash). Spoofing can falsify a DB row, never a chain fact, which is why the auditable state lives on-chain |

Residual trust is narrow and explicit: the producer chooses the brief's quality bar
(mitigated by the critic's score being public), the contributor chooses what "delivery" means within
the spec, and both depend on the underlying chain's liveness for settlement.

## 10. Verification

Any third party can confirm every claim in this repository without a private key:

- `npm run verify` re-reads every recorded address per chain, confirms bytecode exists, and checks
  that each escrow's settlement token matches that chain's USDG.
- Every transaction cited in [README.md](../README.md) is a real, resolvable hash on a public explorer.
- The committed split table, its fee row and its weight sum are readable from the splits contract.
- Token metadata exposes the brief hash, delivery hash, escrow release transaction and critic score,
  so the review trail is reproducible from chain state and the app's metadata endpoint.

## 11. Limitations

Stated plainly, because overstating them would undermine the rest:

1. **One splits instance per work.** `commitSplit` is one-shot; sealing a second work requires
   deploying a new instance. Batching multiple works per instance is future work.
2. **The Arbitrum Sepolia deployment is live but unexercised.** All three contracts are deployed and
   readable there, but no transaction loop has been run because the demo wallets hold no testnet
   USDG on that chain. The registry marks which chains are fully exercised rather than implying
   parity.
3. **The data layer's local mode is single-process.** The JSON store exists so the app runs with
   zero setup; production deployment would use Postgres.
4. **Quality remains a model judgement.** A trained, reproducible critic is a large improvement over
   an opinion, but it is not ground truth, and it is not a substitute for a producer's own review.
5. **Non-visual deliverables are scored by fallback heuristics.** The trained critic is
   image-oriented; audio and text rely on the deterministic fallback paths, which the UI does not
   present as model output.
6. **Contracts are unaudited.** This is buildathon software. It has not been reviewed by a third
   party and should not hold real value as-is.
7. **Settlement assumes a standard ERC-20.** Transfers use the plain return-value check rather than
   `SafeERC20`; USDG satisfies this, but a fee-on-transfer or no-return-value token would break
   payout accounting and is not supported.

## 12. Roadmap

**Near term**
- Batch multiple works onto one splits instance while preserving immutability.
- Score audio and text with trained heads, removing reliance on fallback heuristics.
- Fund and exercise the Arbitrum Sepolia deployment end-to-end to reach chain parity.
- Indexer for per-contributor earnings history across works.

**Medium term**
- Multi-party escrow review: several reviewers signing a score rather than one producer.
- Escrow top-ups and milestone splits for long engagements.
- Fiat on-ramp at the storefront so buyers need not acquire USDG first.

**Long term**
- A portable reputation record derived from attested deliveries and committed scores, owned by the
  contributor rather than the platform.
- Cross-chain settlement via Arbitrum's interop stack, keeping the split table on the home chain.

## 13. Conclusion

The interesting claim in Creator Foundry is not that it puts a payment in a contract. It is that the
contract can make **inaction** decisive: a contributor's delivery opens a clock that pays them if the
producer disappears, and a producer's deadline returns the reward if the delivery never arrives.
Neither party needs the other to behave well, and neither needs the platform's permission to be paid.

Everything downstream follows from that — immutable splits, permissionless release, a reproducible
critic, and a review record that lives with the asset. The result is a production pipeline where the
money, the attribution and the review trail are all legible to the people doing the work, and
verifiable by anyone who wasn't there.
