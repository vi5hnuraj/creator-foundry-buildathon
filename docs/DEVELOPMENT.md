# Creator Foundry — Development Guide

Conventions, tooling, extension recipes and the debugging playbook for people working on this repo.
For where things live, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts Next.js on the first free port (prefers `3000`). Each port gets its own build dir (`.next-dev-<port>`), so several dev servers can run side by side without chunk corruption. |
| `npm run build` | Production build into `.next`. Must pass before submitting. |
| `npm start` | Serve the production build. |
| `npm run typecheck` | `tsc --noEmit`. The fastest correctness gate — run it after every change. |
| `npm run seed` | Populate the local JSON store with demo works, bounties, sales and assets. |
| `npm run check:usdg` | Print USDG balances across the known chains. |
| `npm run verify` | Read-only on-chain verification of every recorded address. No key needed. |
| `npm run deploy <chain>` | Compile and deploy the three contracts; write `contracts/deployments.json`. |
| `npm run demo:escrow <bountyId>` | Drive the producer side of one bounty end-to-end on-chain (`--score`, `--app-url`). |
| `npm run demo:seal <workId>` | Seal a work, commit the split, buy a copy, release and withdraw (`--price`, `--app-url`). |

All scripts live in `scripts/` as plain `.mjs` — no build step, no TypeScript, runnable with `node`.

---

## 2. Local workflow

```bash
npm run typecheck     # after edits
npm run dev           # in terminal 1
# python critic, optional, terminal 2
cd services/critic && source .venv/bin/activate && CRITIC_PORT=8787 python serve.py
```

Before opening a PR or submitting:

```bash
npm run typecheck && npm run build && npm run verify
```

### Running several instances

`next.config.js` derives `distDir` from `NEXT_DEV_PORT`, which `scripts/dev-port.mjs` sets. Two
`npm run dev` invocations therefore produce `.next-dev-3000` and `.next-dev-3100` and cannot
clobber each other — the original cause of `ChunkLoadError`. If you ever see that error anyway,
delete the stale `.next-dev-*` directories.

---

## 3. Conventions

### Layering

Keep the boundaries in [ARCHITECTURE.md §2](ARCHITECTURE.md#2-layering-rules). The two that bite:

- Client components import **pure** modules only. Anything touching Supabase, `node:fs` or the
  service key belongs in a `-server` module or a route handler.
- Split math intentionally exists twice (`lib/split-math.ts` mirrors `buildRevenueSplit()`), because
  the server module pulls in viem's node transport. **If you change one, change the other**, and
  remember the server result is authoritative.

### Service functions

Everything in `src/lib/services/` returns the same shape:

```ts
type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

Route handlers do `const r = await doThing(...); if (!r.ok) return json({ error: r.error }, 400)`.
Never throw across the service boundary, and never let a route handler contain business logic —
the AI agents call these same functions, and duplicated logic is how they drift apart.

### Money

USDG has **6 decimals** and is handled as `bigint` at the edges. The DB fields named `*_eth` are
USDG-denominated decimals kept for backwards compatibility — do not rename them without a
migration, and always convert through `parseUsdg` / `formatUsdg` in `lib/usdg-payments.ts`.
Float arithmetic on money is a bug even when it looks fine in the demo.

### Honesty rules

These are load-bearing for the project's credibility:

- **Never fabricate a transaction hash.** If nothing was written on-chain, return a null hash and
  `simulated: true`; the UI renders that as simulated.
- **Never present a fallback as a model verdict.** If the critic service didn't answer, say so.
- **Never hardcode a claim the code can't back.** Statements in the docs must resolve to a
  transaction or to `npm run verify`.

### Style

- TypeScript strict; no `any` in new code unless interfacing with an untyped boundary, and localize
  the cast.
- Comment the **why**, not the what. The existing comments explain decisions and past bugs
  (rounding, fee-bps derivation, chunk corruption); match that bar.
- UI copy is sentence case, plain-language, and avoids promising more than the contract does.
- Tailwind + the design tokens in `src/styles/design-system`; use the semantic classes
  (`text-t1`, `card`, `rf-data`) rather than raw hex values.

### Naming

Files are kebab-case. Modules are named for their responsibility, not their implementation
(`asset-forge.ts`, `split-math.ts`, `usdg-payments.ts`, `local-store.ts`). Avoid vendor or
codename-derived names in files, constants, types or DB values — they age badly and confuse
reviewers.

---

## 4. Extension recipes

### Add an API route

1. Create `src/app/api/<name>/route.ts`.
2. Export `runtime = "nodejs"` if you need Node APIs.
3. Resolve the work/route param with `resolveWorkParam` (accepts slug *or* UUID).
4. Do the work in a **service function**, then return `NextResponse.json(...)`.
5. On failure return `{ error }` with a meaningful status — `lib/api.ts` surfaces it verbatim.

### Add a page

Put it under `src/app/<route>/page.tsx`. If it needs the wallet, wrap the body in
`<RequireWallet>`. Talk to the backend only through `lib/api.ts`. If it renders money, use
`Amount`; if it renders a hash, use `TxLink`.

### Add a field to a bounty

1. Extend the `Bounty` type in `src/lib/supabase.ts`.
2. Default it in the create path (`services/bounties.ts`) so the local store stays consistent.
3. If it's on-chain-relevant, add it to `scripts/deploy.mjs`/the verify script only when it changes
   contract state.

### Change the split rule

1. Edit `buildRevenueSplit()` in `lib/asset-forge.ts` (server, authoritative).
2. Mirror the numerics in `lib/split-math.ts` (client preview).
3. Keep every on-chain ratio an **integer** summing to exactly 100, keep the fee derived from the
   **rate** (`feeBps`) rather than from the fee row's weight, and keep duplicate payees consolidated
   by address — the contract rejects both violations.

### Add a contract

1. Add the `.sol` file under `contracts/src/` (Solidity `^0.8.x`, MIT header, `ReentrancyGuard` where it
   moves value, custom errors over string reverts).
2. Wire it into `scripts/deploy.mjs` and record it in `contracts/deployments.json` for **every** chain.
3. Add its ABI subset to `lib/chains.ts` (or `lib/nft-contract.ts`) and a resolver that goes through
   `addressOrNull`.
4. Add it to `scripts/verify-onchain.mjs` so it can't silently rot, and document its surface in
   ARCHITECTURE §5.

### Add an AI agent

Add a static method on `FoundryOrchestrator` in `services/ai.ts` that (a) grounds its prompt in the
work's own title/description/memory, (b) provides a substantive **fallback** so the app works with
no credentials, and (c) is reachable through a thin route handler. Never let a fallback invent
data that looks like model output.

---

## 5. Testing strategy

There is no unit-test runner in this repo; verification is done with type checking, a production
build, and scripts that assert against reality.

| Layer | How it's checked |
|---|---|
| Types / imports | `npm run typecheck` |
| Routes and build integrity | `npm run build` |
| Contract addresses, bytecode, escrow↔USDG pairing | `npm run verify` |
| Escrow lifecycle | `npm run demo:escrow <bountyId>` |
| Seal → sale → split payout | `npm run demo:seal <workId>` |
| Money math | assert `weights` sum to 10,000 and ratios sum to 100 in the split route |

**When adding a feature, prefer a script that asserts against the chain over a mock.** A passing
typecheck proves the code compiles; `npm run verify` proves the submission's claims are still true.

---

## 6. Debugging playbook

| Symptom | Likely cause | Action |
|---|---|---|
| `ChunkLoadError` | stale/duplicated dev build dirs | remove `.next-dev-*`, restart |
| A route 404s on a pretty URL | slug not allocated, or wrong chain's DB | open `/works`, use the canonical link |
| On-chain button does nothing | wallet not connected / wrong network | `RequireWallet` prompts; check the chain in MetaMask |
| Action returns "simulated" | no signer configured and no wallet connected | expected in browse-only mode |
| Escrow controls absent | `ESCROW_ENABLED === false` for the active chain | `npm run verify` to see the surface |
| Critic always falls back | Python service not running / URL unset | start it and set `CRITIC_SERVICE_URL` |
| `FeeTooHigh` on commit | fee bps derived from a fee row's weight instead of the rate | recheck `toSplitWeights` — this is a fixed bug, don't reintroduce it |
| `DuplicatePayee` on commit | split rows not consolidated by address | `buildRevenueSplit` consolidates; verify the caller used it |
| Money looks off by a factor of 10⁶ | missed a `parseUsdg`/`formatUsdg` boundary | grep for raw arithmetic on `*_eth` fields |
| Data appears to vanish | local store is per-invocation, not per-user | confirm you're hitting the same server/port, or move to Supabase |

---

## 7. The one-shot Splits constraint

`commitSplit` is intentionally one-shot: once a work's payout table is committed it can never be
changed, which is the whole point of the royalty guarantee. The practical consequence is that
**each sealed work needs its own `CreatorFoundrySplits` deployment**; the shipped demo instance is
permanently bound to the first sealed work.

To seal a second work for real:

```bash
# deploy a fresh Splits instance for the new work and record its address,
# then point the seal flow at it before committing
npm run deploy <chain>
```

Never "fix" this by making the table mutable. If you need multiple works, deploy multiple
instances — that is the design, and it's the honest trade for an auditable royalty promise.

---

## 8. Pre-submission checklist

- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds
- [ ] `npm run verify` passes with 0 failures, on the chain(s) claimed in the docs
- [ ] Every address and transaction hash in the README resolves
- [ ] Docs match the code — no stale file names, no dead commands, no aspirational features
- [ ] No secrets in the repo: `.env.local`, `FORGE_PRIVATE_KEY` and API keys stay gitignored
- [ ] `npm run seed` + a full manual walkthrough succeeds on a **fresh clone**
- [ ] Demo and pitch videos recorded (see [SUBMISSION.md](SUBMISSION.md))

## 9. Code review checklist

- Does the change keep the layering rules intact?
- Does any new on-chain path have an honest simulated fallback?
- Is money handled as bigint at the boundary, through the shared helpers?
- Are new failure modes reported to the user in plain language rather than swallowed?
- If split math changed, was `split-math.ts` mirrored and do the weights still sum to 10,000?
- If a contract changed, were `deploy.mjs`, `verify-onchain.mjs` and `contracts/deployments.json` updated?
- Do the docs still describe the code as it is?
