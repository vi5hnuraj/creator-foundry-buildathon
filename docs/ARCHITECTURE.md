# Creator Foundry — Architecture

How the system is put together, why each boundary is where it is, and what to touch when you want
to change something. Read [OVERVIEW.md](OVERVIEW.md) first if you want the product story.

## 1. System at a glance

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Browser (Next.js App Router, client components)                               │
│                                                                               │
│  /            /works          /artist      /work/[id]   /work/[id]/seal       │
│  landing      producer desk   contributor  board        /work/[id]/store      │
│                                                                               │
│  wagmi + viem + RainbowKit ── signs every state change from the user's wallet │
│  lib/api.ts ── the ONLY way screens talk to the backend                       │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │  fetch /api/*  (JSON, { error } on failure)
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ Next.js route handlers (src/app/api/**)                                       │
│  validate → resolve slug/UUID → call ONE service function → return JSON        │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┬──────────────────────┐
        ▼                       ▼                       ▼                      ▼
┌────────────────┐   ┌────────────────────┐  ┌───────────────────┐  ┌──────────────────┐
│ services/      │   │ asset-forge.ts     │  │ storage.ts        │  │ Python critic    │
│ works          │   │ usdg-payments.ts   │  │ (objects +        │  │ (FastAPI, CLIP)  │
│ bounties       │   │ chains.ts (registry│  │  temp bytes)      │  │ POST /critic/    │
│ sales  ai      │   │  per-chain addresses)│ └───────────────────┘  │   score          │
└───────┬────────┘   └─────────┬──────────┘                          └──────────────────┘
        ▼                      ▼
┌────────────────┐   ┌──────────────────────────────────────────────────────────┐
│ supabase.ts    │   │ Arbitrum (Sepolia 421614 · Robinhood Orbit 46630)         │
│  ─ Supabase    │   │  AssetNFT · Splits · BountyEscrow · Paxos USDG            │
│  ─ local-store │   └──────────────────────────────────────────────────────────┘
│    (JSON file) │
└────────────────┘
```

## 2. Layering rules

These are enforced by convention, not by a linter — but breaking them has bitten us, so they matter.

| Layer | May import | Must never |
|---|---|---|
| `src/app/**/page.tsx` | `components/`, `lib/api.ts`, `lib/slug.ts`, `lib/*-math.ts` | services, `supabase`, `node:*` |
| `src/app/api/**/route.ts` | `lib/services/*`, `lib/*`, `lib/slug-server.ts` | React |
| `src/lib/services/*` | `supabase`, `lib/asset-forge`, `lib/storage`, other services | `next/server`, React |
| `src/lib/*` | each other, `viem` | `src/components` |
| `src/components/*` | `lib/*-math.ts` (pure), `lib/api.ts` | services, `supabase` |

Two concrete rules that came from real breakage:

- **Client components may only import pure modules.** `lib/slug.ts` is deliberately import-free of
  Supabase; `lib/slug-server.ts` holds the Supabase-backed resolution. Merging them broke the
  production client build with an `UnhandledSchemeError` for `node:path`.
- **Split math exists twice, on purpose.** `lib/split-math.ts` is the client mirror of
  `buildRevenueSplit()` in `lib/asset-forge.ts`, because the server module reaches for viem's node
  transport. The server result is authoritative; the mirror only drives the seal-page preview.

## 3. Module map

### `src/lib` — core

| Module | Responsibility |
|---|---|
| `chains.ts` | Chain registry for Arbitrum Sepolia + Robinhood testnet; resolves NFT/Splits/Escrow/USDG addresses for the **active** chain from `contracts/deployments.json`; exports `ERC20_ABI` and `BOUNTY_ESCROW_ABI`. |
| `asset-forge.ts` | Split math (`buildRevenueSplit`, `buildFeeSplit`, `toSplitWeights`, `priceWithFee`), fee constants, and forge actions (deploy/mint/seal/copy) with wallet/server/simulated modes. |
| `nft-contract.ts` | Re-exports the resolved contract addresses plus `NFT_ABI`, `SPLITS_ABI`, `ASSET_MINTED_TOPIC` (keccak of `AssetMinted(uint256,address,address,uint96)`) used to read the real `tokenId` out of a receipt. |
| `usdg-payments.ts` | The escrow/USDG write helpers: `fund`, `assignContributor`, `attestDelivery`, `release`, `autoRelease`, `refund`, plus `parseUsdg` / `formatUsdg` / `formatCountdown`. |
| `wagmi.ts` | wagmi chain objects, transports, connectors. |
| `explorer.ts` | Builds explorer URLs for whichever chain is active. |
| `supabase.ts` | The single query-builder surface + the `Work`/`Bounty`/`Sale` types. Chooses Postgres or the local store. |
| `storage.ts` | Object storage adapter (upload, download-to-temp, cleanup temp). |
| `slug.ts` / `slug-server.ts` | Human-readable work URLs: pure slugify + UUID detection; server-side unique-slug allocation and slug-or-UUID resolution. |
| `split-math.ts` | Client mirror of the split rule and `buildRoyaltyRows()` for display tables. |
| `attestation.ts` | Builds the brief/delivery hashes that the contracts commit to. |
| `owner-guard.ts`, `use-identity.ts` | Wallet-is-identity helpers: server-side ownership checks and the client hook. |
| `api.ts` | Client fetch helpers (`apiGet`, `apiPost`, `apiUpload`) and `cleanError()` — the only backend access path from screens. |
| `files.ts` | Asset bucket name + URL helpers (client-safe so previews work without the service key). |

### `src/lib/services` — the operation layer

| Module | Responsibility |
|---|---|
| `works.ts` | Create/list/get works; legacy forge compatibility for collection deployment. |
| `bounties.ts` | The bounty state machine as functions: create, claim, deliver, attest, `approveAndMint` (NFT + escrow release in one flow), escrow status. |
| `sales.ts` | Copy purchases, split listing creation, revenue queries. |
| `ai.ts` | `FoundryOrchestrator`: production planning, creative memory derivation, critic orchestration, contribution-split recommendation, story ideas, publishing copy, director chat. |
| `local-store.ts` | `mockSupabase` — the query-builder implementation over `data/local/.creator-foundry-db.json`, so the whole product runs with no database. |

Every service function returns the same shape, which is what lets HTTP routes and AI agents share
one code path:

```ts
type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

### `src/app` — routes and pages

| Page | Audience |
|---|---|
| `/` | Landing: pitch, verified-contract summary, chain status. |
| `/works` | Producer desk: every work, its bounties, escrow state and royalty table. |
| `/artist` | Contributor hub: open bounties with the locked amount shown first, "my tasks", deliver/attest actions, and the **Royalty revenue** card. |
| `/work/[id]` | Owner-only board: chat, plan, bounties, escrow controls (lock / start SLA clock / release via SLA / reclaim), review modal. |
| `/work/[id]/seal` | Seal: preview the split table, then commit it on-chain. |
| `/work/[id]/store` | Public storefront: buy a copy; royalty table and revenue card. |

Route params accept **either a UUID or a slug**, so `/work/neon-requiem/store` and the legacy
`/work/58083ed7-…/store` both resolve. See §6.

API surface (all under `src/app/api`, all returning JSON with `{ error }` on failure):

| Route | Purpose |
|---|---|
| `POST /api/ai/director` | Brief → production plan |
| `POST /api/ai/chat` | Director chat grounded in the work's memory |
| `GET/POST /api/ai/memory` | Creative memory read/update |
| `POST /api/ai/critic` | Score a delivery (Python service, then fallback) |
| `POST /api/ai/contribution` | Recommend revenue shares from minted contributions |
| `POST /api/ai/story`, `/api/ai/publish`, `/api/ai/populate` | Story beats, launch copy, seeding |
| `GET/POST /api/works`, `GET /api/works/[id]` | List/create/read works |
| `POST /api/works/[id]/split` | The exact on-chain split table (payees, weights, feeBps) |
| `POST /api/works/[id]/seal` | Commit the split table + mint the release NFT |
| `GET/POST /api/bounties` | List / create bounties |
| `POST /api/bounties/[id]/claim` | Claim an open bounty (guarded update) |
| `POST /api/bounties/[id]/deliver` | Record a delivery + artifact hash |
| `POST /api/bounties/[id]/attest` | Contributor attestation record |
| `POST /api/bounties/[id]/escrow` | Escrow status / fund / assign / refund |
| `POST /api/bounties/[id]/approve` | Mint the NFT and release the escrow in one flow |
| `GET /api/metadata/[id]`, `/api/metadata/work/[id]` | ERC-721 metadata with the on-chain/story attributes |
| `GET/POST /api/sales`, `POST /api/sales/buy`, `/api/sales/bridge` | Copy sales |
| `POST /api/upload`, `GET /api/files/[...path]` | Object write and read sides of the asset pipeline |

## 4. Data model

`Work`, `Bounty` and `Sale` are declared in `src/lib/supabase.ts` and work identically against
Postgres or the JSON store.

**Work** — the project.
`id · title · description · requester_addr · status (open|sealed) · creative_memory · slug ·
base_price_eth (copy price in USDG units) · seal_tx_hash · split_tx_hash · seal_mode (onchain|simulated)`

**Bounty** — one scoped task and its escrow lifecycle.
`id · work_id · title · role · reward_eth · revenue_percent · instructions · deliverable_specs ·
status (open|claimed|delivered|approved|minted) · claimed_by · claimed_by_kind (human|agent) ·
delivery_ipfs · delivery_path · critic_feedback · brief_hash · delivery_hash · escrow_key ·
escrow_tx_hash · escrow_kind · escrow_release_tx · escrow_release_kind · escrow_critic_score ·
delivery_window_seconds · review_window_seconds · attest_tx_hash · mint_mode · mint_tx_hash ·
token_id · payment_tx_hash`

**Sale** — one copy purchase.
`id · work_id · buyer_addr · amount_eth · source (usdg_storefront) · tx_hash`

Money semantics: `reward_eth` and `base_price_eth` are **USDG base units expressed as a decimal
number** (USDG has 6 decimals). The names are historical; everywhere in the UI they render as USDG.
Helpers `parseUsdg` / `formatUsdg` in `usdg-payments.ts` are the only place the conversion happens.

## 5. Contract architecture

Three contracts in `contracts/src/`, no proxies, no upgrade path — deliberately.

### `CreatorFoundryAssetNFT`
`ERC721URIStorage + ERC2981 + Ownable`.
- `mint(address to, string uri, address royaltyReceiver, uint96 royaltyBps) → uint256 tokenId`
- Emits `AssetMinted(uint256 indexed tokenId, address indexed to, address indexed royaltyReceiver, uint96 royaltyBps)`.
- The app reads the real `tokenId` from that event rather than guessing, so a minted row can never
  point at the wrong token.

### `CreatorFoundrySplits`
`Ownable + ReentrancyGuard`. One instance per sealed work.
- `commitSplit(...)` — one-shot (`AlreadyCommitted`), rejects duplicate payees, requires weights to
  sum to exactly 10,000, and caps the fee at `MAX_FEE_BPS = 1_500` (default `DEFAULT_FEE_BPS = 300`).
- `release()` — **permissionless**; splits the contract's balance pro-rata by weight.
- `withdraw()` / `withdrawTo(address)` — pull a single payee's own balance.
- `pendingBalance(address)` — what a payee can withdraw right now.
- `whenCommitted` guards everything, so an unsealed work can never be drained by a stale caller.

Because `commitSplit` is one-shot, **each sealed work needs its own Splits deployment**. The demo
instance is permanently bound to the first sealed work — this is a real constraint, not an
oversight (see [DEVELOPMENT.md](DEVELOPMENT.md#7-the-one-shot-splits-constraint)).

### `CreatorFoundryBountyEscrow`
`ReentrancyGuard`. One instance per chain, keyed by `keyFor(bountyId)`.

```
fund(key, amount, briefHash)              producer   → locks USDG + fixes the spec
assignContributor(key, contributor,       producer   → starts BOTH clocks; window bounds
                  deliveryWindow,                     enforced (5 min … 90 days)
                  reviewWindow)
attestDelivery(key, deliveryHash)         contributor→ records the artifact hash; opens the
                                                     review window, permanently closes refund
release(key, criticScore)                 producer   → pays the contributor, stamps the score
autoRelease(key)                          ANYONE     → after reviewDeadline, pays the contributor
refund(key)                               producer   → after deliveryDeadline, before attestation
releasable / deliveryTimeLeft /           views for the UI
reviewTimeLeft / escrows
```

A `refund()` is **not terminal**: the escrow records `refunded = true` and the same key can be
funded again, which is how a bounty that expired reopens for a different contributor. A *paid*
escrow is terminal — re-funding one would let a single delivery pay out twice.

> **Reading `escrows()` correctly.** The public getter returns a positional tuple that must mirror
the contract's `Escrow` struct **field for field, in order**. The app's ABI once omitted `refunded`,
which silently shifted every later field by one: `briefHash` was decoded into the `refunded` slot and
`criticScore` was read from the low 16 bits of `deliveryHash` — a wrong number, with no error. Any
change to the struct requires a matching change in `BOUNTY_ESCROW_ABI` (`lib/chains.ts`) and in
`scripts/verify-onchain.mjs`.

Safety properties, each with the error that enforces it:

| Property | Enforced by |
|---|---|
| One escrow per bounty, funded once | `AlreadyFunded` / `NotFunded` |
| Only the producer funds, assigns, releases, refunds | `NotProducer` |
| Only the assigned contributor attests | `NotContributor`, `ContributorUnset` |
| Assignment happens exactly once | `ContributorAlreadySet` |
| A refund can never race a delivery | `DeliveryWindowOpen`, `AlreadyAttested` |
| `autoRelease` cannot fire early or without delivery | `ReviewWindowOpen`, `NotAttested` |
| Windows can't be degenerate | `InvalidWindow` (with `MIN_WINDOW`/`MAX_WINDOW`) |
| No double payout | `AlreadyReleased` |
| Native ETH can never be trapped | `EthNotAccepted` |

## 6. Human-readable URLs

`lib/slug.ts` derives a kebab-case handle from the title (`"Neon Requiem"` → `neon-requiem`),
stripping bracketed qualifiers and diacritics. `lib/slug-server.ts` allocates a unique slug
(`-2`, `-3` … on collision) and resolves a route param to a work **accepting either form**, so old
UUID links and explorer metadata URLs keep working forever. Pages and API routes share that resolver,
which is why `/work/neon-requiem`, `/work/58083ed7-…` and
`/api/metadata/work/neon-requiem` all hit the same row.

## 7. Chain resolution and the per-chain registry

The earliest version kept contract addresses in flat `NEXT_PUBLIC_*` variables. That broke in a
specific, dangerous way: deploying to a second chain overwrote the variables, so the app kept
pointing at the previous chain's contracts — and because addresses were "valid-looking", nothing
failed loudly. The fix is a registry.

- `contracts/deployments.json` is the **source of truth**: `chains.<key> = { label, chainId, rpc, explorer,
  usdg, nft, splits, escrow, primary, note }`.
- `chains.ts` resolves for `ACTIVE_CHAIN_KEY` (from `NEXT_PUBLIC_CHAIN`, defaulting to
  `arbitrum-sepolia`) with env vars only as a fallback, and exports `ESCROW_ENABLED`,
  `DEPLOYMENT_INCOMPLETE` and `CHAINS_WITH_FULL_DEPLOYMENT` so the UI can be honest when a chain's
  contract set is partial.
- `scripts/deploy.mjs` reads/writes the registry and **verifies bytecode exists at the recorded
  address** before keeping it — a skip-guard added after a fallback path nearly recorded a dead
  address. It writes `.env.local` only when deploying the active chain.
- `scripts/verify-onchain.mjs` is read-only and needs no key; §8 prints the per-chain deployment
  surface and checks the escrow's `token()` matches the chain's USDG.

`ESCROW_ENABLED === false` is a supported state: payouts fall back to a direct producer →
contributor transfer, and the UI says so instead of pretending an escrow exists.

## 8. The AI layer

`FoundryOrchestrator` (in `services/ai.ts`) is a set of named agents, not a free-roaming agent loop:

| Agent | Output | Grounding |
|---|---|---|
| Director / planner | `ProductionPlan` (inspiration board + suggested bounties) | brief + conversation context; bounded JSON extraction with a genre-matched fallback |
| Creative memory | palette, characters, locations, art style, tone | **derived from the work's own words** via genre profiles + proper-noun extraction, never generic mock data |
| Critic | `CriticReport` (score, three sub-signals, recommendation) | the project's palette plate via the Python service |
| Contribution split | integer revenue shares per contributor | minted assets, roles and reward weight |
| Story / publishing / chat | prose assets | the work's title + description, so answers are project-specific |

Provider chain is explicit and degradable: **OpenAI-compatible endpoint → project-derived local
fallback**. The fallback is not a stub — it produces genre-matched, project-grounded output, so the
app is fully demonstrable with no credentials, and nothing in the UI ever presents a fallback
number as a model verdict.

The **trained critic** is a separate service (`services/critic/serve.py`, FastAPI):
- frozen **CLIP ViT-B/32** backbone + a small trained head (`services/critic/critic_head.pt`),
- per-project **palette plates** built from the creative memory, so scoring is relative to that
  project's art direction,
- returns `style_score`, `palette_match`, `quality`, `notes`, `model`.
The app composes the final score as `0.6·style + 0.4·quality` and records the model name, so a
score is always attributable to a provider. If the service is unreachable the response says so.

## 9. Key decisions and their trade-offs

| Decision | Why | Cost we accepted |
|---|---|---|
| Own contracts instead of a CLI/mint-service dependency | We needed escrow semantics and a two-clock SLA, which no drop-in tool provides; it also removes a hosted dependency from the judged path | We own deployment, verification and gas |
| `release()` doesn't require on-chain attestation | The producer is only ever moving money *toward* the contributor; requiring attestation would add a way to strand a legitimate payout | A producer can pay before attestation — a strictly safe direction |
| Two independent windows | A single timer lets either party grief by silence | Producers must set two values at assignment |
| Permissionless `autoRelease` and `splits.release()` | A stalled human must never be able to block a payout | Anyone can trigger them — but only to the pre-committed destinations |
| Immutable, no-proxy splits table | "The creators get paid" has to be auditable, not upgradeable | One-shot `commitSplit`; a new work needs a new instance |
| Bigint-safe USDG helpers, one conversion site | 6-decimal stablecoin math in floats is how money bugs happen | Slightly more verbose call sites |
| Slugs that still accept UUIDs | Pretty URLs without breaking explorer links or existing DB rows | Two resolution paths to maintain |
| Simulated mode instead of mock transactions | A demo that shows fake explorer links is a lie | Demo mode has no hash to show — which is the honest outcome |

## 10. Failure modes we designed around

| Failure | Behaviour |
|---|---|
| No LLM key | Genre + brief-derived fallback; app fully functional |
| Critic service down | Explicit fallback and an honest note; never a silent fake score |
| No Supabase credentials | Local JSON store; whole app runs |
| Chain has no escrow deployed | `ESCROW_ENABLED=false`; direct-transfer fallback, clearly labelled |
| Wallet on the wrong chain | wagmi prompts a network switch before writing |
| Producer stalls | Contributor calls `autoRelease` after `reviewDeadline` |
| Contributor stalls | Producer calls `refund` after `deliveryDeadline` |
| Duplicate/rounded split rows | Consolidated per address by `buildRevenueSplit`; contract rejects duplicates as a second line of defence |
| Fee wallet is also a payee | Rows are consolidated for the same address; `feeBps` is derived from the **rate**, not from the fee row's weight (deriving it from the row produced a >1500 bps revert) |
| Slug collision | Suffixed `-2`, `-3`, … at allocation time |
