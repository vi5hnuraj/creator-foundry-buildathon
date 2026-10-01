# Creator Foundry — Setup Guide

From a fresh clone to a running app — and then, optionally, to real on-chain writes.
Every step is labelled with whether it is **required** or **optional**.

---

## 1. Prerequisites

| Tool | Needed for | Notes |
|---|---|---|
| **Node.js ≥ 18.17** (20 LTS recommended) | the app | `node -v` |
| **npm** | dependencies | ships with Node |
| **Python ≥ 3.10** | *optional* — the trained critic | only for real model scores |
| **MetaMask** (or any injected wallet) | *optional* — real transactions | the app is fully browsable without it |

Nothing else. No database, no API key, no paid service is required to run and evaluate the product.

---

## 2. The five-minute path (no keys, no chain, no database)

```bash
git clone <your-repo-url> creator-foundry
cd creator-foundry
npm install
cp .env.example .env.local
npm run seed      # optional: populate demo works/bounties/sales
npm run dev
```

`npm run dev` picks a free port automatically (preferring `3000`) and prints the URL. Open it.

### What you get with zero configuration

- Every page renders: landing, producer desk, contributor hub, work board, seal, storefront.
- The data layer runs on the **local JSON store** (`data/local/.creator-foundry-db.json`) — a real
  query-builder over a file, not a mock that returns nothing.
- The AI director returns **project-derived** plans (genre-matched palette, characters, audio
  direction and bounties from your own brief) instead of erroring.
- On-chain actions report **simulated** with a null transaction hash. Nothing pretends to be a
  transaction that didn't happen.

`npm run seed` is worth running: the demo database is deliberately gitignored, so a fresh clone
starts empty and the seed gives you realistic works, bounties and a sale to click through.

> **Note on the local store.** It is single-process and file-backed, intended for evaluation.
> Point `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` at a Supabase project to use Postgres
> instead — no code changes, same query surface.

---

## 3. Optional — run the trained AI critic

Without this, the critic route falls back to a deterministic, project-grounded analysis. With it,
deliveries are scored by a real trained model.

```bash
cd services/critic
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# if you want to retrain from scratch (~1–2 min on a MacBook, fully synthetic data)
python train.py

CRITIC_PORT=8787 python serve.py   # preloads the model, prints "[serve] critic model ready"
```

Then set in `.env.local`:

```env
CRITIC_SERVICE_URL=http://localhost:8787
```

Smoke test it:

```bash
curl -s -F "candidate=@services/critic/ref_1.png" http://localhost:8787/critic/score
# {"style_score":92.3,"palette_match":0.88,"quality":95.1,"notes":"...","model":"clip-critic-v1"}
```

Keep this running in its **own terminal** — it is a separate process from the Next.js app.
The critic service also needs `APP_ORIGIN` (see the variable table) to fetch app-relative asset
URLs during scoring.

---

## 4. Optional — real on-chain writes

Browse-only mode is enough to evaluate the product. Follow this to actually move USDG.

### 4.1 Add the network to your wallet

| Field | Arbitrum Sepolia (recommended) | Robinhood Chain Testnet |
|---|---|---|
| Network name | Arbitrum Sepolia | Robinhood Chain Testnet |
| Chain ID | `421614` | `46630` |
| RPC URL | `https://sepolia-rollup.arbitrum.io/rpc` | `https://rpc.testnet.chain.robinhood.com` |
| Symbol | ETH | ETH |
| Explorer | `https://sepolia.arbiscan.io` | `https://explorer.testnet.chain.robinhood.com` |

### 4.2 Fund it

**Gas (ETH):**
- https://arbitrum.faucet.dev/
- https://faucet.quicknode.com/arbitrum/sepolia
- https://sepolia-faucet.pk910.de/ (proof-of-work faucet, usually available)

**USDG (the settlement token, 6 decimals):**
- Arbitrum Sepolia USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`
- Robinhood testnet USDG: `0x7E955252E15c84f5768B83c41a71F9eba181802F`
- Obtain it from the hackathon Discord, the Paxos sandbox dashboard (deposit → USDG → Sepolia), or
  a community faucet. Check what you hold at any time:

```bash
npm run check:usdg
```

### 4.3 Point the app at your chain

```env
NEXT_PUBLIC_CHAIN=arbitrum-sepolia     # or robinhood-testnet
```

Restart the dev server after changing it. `contracts/deployments.json` already records a full contract set
for **both** chains, so no address configuration is needed — see
[DEPLOYMENT.md](DEPLOYMENT.md) if you want to deploy your own.

> ⚠️ Flipping `NEXT_PUBLIC_CHAIN` changes which contracts and which **explorer** the app links to.
> Because the local JSON store is shared, links generated under one chain will 404 on the other.
> Pick your chain before recording a demo.

### 4.4 Walk the loop

1. Connect the wallet that will be the **producer**.
2. Create a work, accept the AI's bounties.
3. On a bounty, open **Lock reward**, choose windows (there is a *5 minutes — live demo* preset),
   and sign. This calls `escrow.fund()` + `assignContributor()`.
4. Switch to a second wallet (the **contributor**), claim the bounty in the Contributor Hub, upload a
   deliverable, and sign the attestation.
5. Back on the producer wallet, review the deliverable, run the critic, and **Approve** — this mints
   the NFT and releases the escrow.
6. Seal the work, then buy a copy from the storefront to see the split pay out.


---

## 5. Optional — deploy the contracts yourself

```bash
# put a funded burner key in .env.local first (see the variable table)
npm run deploy arbitrum-sepolia      # or: npm run deploy robinhood-testnet
```

The script compiles with `solc`, deploys the three contracts, writes the addresses into
`contracts/deployments.json`, and only rewrites `.env.local` when the chain being deployed is the active one.
It refuses to record an address unless it can read bytecode back from it.

Then verify everything, read-only and with no key:

```bash
npm run verify
```

That script re-reads every recorded address per chain, checks the escrow's `token()` matches that
chain's USDG, and prints the deployment surface. Use it before every submission or demo.

---

## 6. Environment variables

`.env.local` is for secrets and machine-specific values and is gitignored.
`.env.example` is the committed template.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CHAIN` | no | `arbitrum-sepolia` (default) or `robinhood-testnet`. Selects the registry entry. |
| `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` | no | Override the registry for NFT only (rarely needed). |
| `NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS` | no | Override the registry for Splits only. |
| `NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS` | no | Override the registry for Escrow only. Unset ⇒ direct-transfer fallback. |
| `FORGE_PRIVATE_KEY` | no | Enables server-side transactions. **Never** expose to the client. Unset ⇒ simulated mode. |
| `FORGE_FEE_WALLET` | no | Platform fee recipient for splits. Defaults to a placeholder — set it before any real sale. |
| `FOUNDRY_AI_BASE_URL` | no | OpenAI-compatible endpoint, e.g. `https://api.groq.com/openai/v1`. |
| `FOUNDRY_AI_KEY` | no | Key for the above. |
| `FOUNDRY_AI_MODEL` | no | Model id; the code retries known-good models if this one is retired. |
| `CRITIC_SERVICE_URL` | no | The Python critic, e.g. `http://localhost:8787`. Unset ⇒ built-in fallback. |
| `APP_ORIGIN` | no | Origin the critic uses to resolve `/api/files/...` asset URLs. |
| `NEXT_PUBLIC_SUPABASE_URL` | no | Use Postgres instead of the local JSON store. |
| `SUPABASE_SERVICE_KEY` | no | Service-role key; server-side only. |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | no | Enables WalletConnect alongside injected wallets. |

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ChunkLoadError` / "Loading chunk failed" | two dev servers sharing a build directory | handled — each port gets `.next-dev-<port>`. If it persists, delete the stray `.next-dev-*` dirs and restart. |
| Port already in use | another server running | nothing to do: `npm run dev` picks the next free port and prints it. |
| `Failed to fetch` on every AI action | dev server not running, or a stale tab | restart `npm run dev`, hard-reload the tab. |
| Critic returns fallback text | `CRITIC_SERVICE_URL` unset, or the Python service isn't running | start it (§3) and set the variable in `.env.local`, then restart Next. |
| "Insufficient funds — the signer wallet doesn't have enough testnet ETH for the price plus gas" | wallet lacks ETH for gas, or USDG for the transfer | fund from the faucets in §4.2. |
| "Work not found" on a slug URL | slug doesn't exist yet, or you're on a different chain than the DB was written under | open `/works` and click through to the canonical URL. |
| Escrow buttons missing | the active chain has no escrow address resolved | check `contracts/deployments.json` for that chain; `npm run verify` prints the surface. |
| App shows an empty producer desk | fresh clone — the demo DB is gitignored | `npm run seed`. |
| Balances/links point at the wrong explorer | `NEXT_PUBLIC_CHAIN` differs from the chain the data was created on | pick one chain and stay on it (§4.3). |
| `Module not found: pino-pretty / lokijs / encoding` | optional wallet-SDK deps | already externalized in `next.config.js`; if it reappears, clear `.next` and reinstall. |
| Critic can't fetch the candidate | `APP_ORIGIN` unset | set `APP_ORIGIN=http://localhost:<port>`. |

---

## 8. Verifying a build before submitting

```bash
npm run typecheck      # tsc --noEmit
npm run build          # production build must succeed
npm run verify         # read-only on-chain verification, every chain
npm run seed           # optional: reset demo data
```

`npm run verify` is the one that matters most: it proves the addresses in the README still resolve
to live bytecode, so the submission's claims stay true after any redeploy.
