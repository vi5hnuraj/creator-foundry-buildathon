# DEPLOYMENT CHEAT SHEET — Robinhood Chain Testnet (primary) + Arbitrum Sepolia

## ✅ DEPLOYED — BOTH CHAINS (dual-chain submission)

### Robinhood Chain Testnet (46630) — PRIMARY DEMO CHAIN
| Contract | Address |
|---|---|
| **CreatorFoundryAssetNFT** (ERC-721 + ERC-2981) | `0xb176b9ea780c534c47c15a9651f7af1b80302b10` |
| **CreatorFoundrySplits** (token = real USDG) | `0x66ffff1d5bd5cd41e4cd9695875f1e8e96bdd845` |
| **CreatorFoundryBountyEscrow** (token = real USDG) | `0x6390674fe1ac130c145299396a5441510d052062` |
| **Paxos USDG (real)** | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |

Explorer: https://explorer.testnet.chain.robinhood.com/address/0xb176b9ea780c534c47c15a9651f7af1b80302b10
Wallet funding: **200 USDG + 0.01 ETH** ✅ ready for the full demo

### Arbitrum Sepolia (421614) — SECONDARY DEPLOYMENT
| Contract | Address |
|---|---|
| **CreatorFoundryAssetNFT** | `0xd63401c8b86c5baa85e4af0e141c4bb55cf4f5ca` |
| **CreatorFoundrySplits** | `0x381f563514b264e7142bd3ea090e34350c0e6693` |
| **CreatorFoundryBountyEscrow** | `0x0a002725a40c46fcdbc7cca488f6469b8203ce96` |
| **Paxos USDG (real)** | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` |

Explorer: https://sepolia.arbiscan.io/address/0xd63401c8b86c5baa85e4af0e141c4bb55cf4f5ca
Escrow: https://sepolia.arbiscan.io/address/0x0a002725a40c46fcdbc7cca488f6469b8203ce96

deployed in tx `0x33efe607823341ff32dd39a560807bcc7504a8a0a7c7551f078afc852be96316` (block 313701657) —
5,252 bytes, `token()` = that chain's USDG, `MIN_WINDOW` = 300s. **All three contracts are live on
both chains**; check with `node scripts/verify-onchain.mjs` (section 8).

Deployer / controller / fee wallet (both chains): `0x79E41C5ba4fd8B6Fdf3E23C41F8429E71981AB3B`
Active chain in `.env.local`: **robinhood-testnet**

### Addresses live in `contracts/deployments.json`, not `.env.local`

Contract addresses are chain-specific, so they are recorded per chain in `contracts/deployments.json` and the
app resolves them for the **active** chain (`src/lib/chains.ts`). `NEXT_PUBLIC_CHAIN` now genuinely
switches the whole contract set — before this, whichever chain was deployed last overwrote the
others and switching pointed the app at contracts that don't exist there.

`npm run deploy <chain>` only rewrites `.env.local` when you are deploying the chain the app is
already pointed at; otherwise it writes `contracts/deployments.json` and leaves `.env.local` alone (add
`--write-env` to force a repoint). So you can deploy to a second chain at any time without
disturbing a working demo.

> **Do not switch the active chain on the machine that has the demo database.** One local DB is
> shared across chains and explorer links are built from the active chain, so flipping to Arbitrum
> would rewrite the recorded Robinhood transaction links into arbiscan 404s.

### ✅ One complete bounty loop, executed for real (every tx verifiable)

Bounty `Concept Art – Inspector Vale Character Design` (1.8 USDG), Neon Requiem project.
Each line is a real transaction on Robinhood Chain Testnet:

| Step | Transaction |
|---|---|
| 1. Producer approves USDG to the escrow | [`0xe26f1fb6…`](https://explorer.testnet.chain.robinhood.com/tx/0xe26f1fb68a7c437eb54dc55794fd774542862bc7a2984d86f12cf9595146ee84) |
| 2. **Reward locked in escrow** (+ brief hash) | [`0x8c4aaff3…`](https://explorer.testnet.chain.robinhood.com/tx/0x8c4aaff3b0e3c1a6a1095845bfb910cc740b074795349e4fedb660ba0813ff3f) |
| 3. Contributor named, SLA clocks started | [`0x8f7cc410…`](https://explorer.testnet.chain.robinhood.com/tx/0x8f7cc410037819926610a1e4a5ee9fdd4979d8fb9017e5c348c5adbab7234fca) |
| 4. Authorship NFT minted to the contributor | [`0x5b1875a6…`](https://explorer.testnet.chain.robinhood.com/tx/0x5b1875a627ec98d7e2dff03404e2f115772fc348f0eadfa26636cd7f1a1b7437) |
| 5. **Escrow released — contributor paid** (score 80) | [`0x4f6c9be2…`](https://explorer.testnet.chain.robinhood.com/tx/0x4f6c9be2c727534017d6f4d07050da5d83472f4508a8f02f74cae395e0694afd) |

Read back from the chain afterwards: `escrows(key).released = true`, `criticScore = 80`,
contributor USDG balance went **0 → 1.8**, `ownerOf(1)` = the contributor wallet.

### ✅ The royalty half, also executed for real

Work `Neon Requiem` — sealed, committed, sold and paid out:

| Step | Transaction |
|---|---|
| Work release NFT minted (token 2) | [`0xb1f07f3f…`](https://explorer.testnet.chain.robinhood.com/tx/0xb1f07f3f465ff51fddb306042f09d4405862b766959b42b93084fbd7ee88f55f) |
| **`commitSplit` — the immutable payout table** | [`0x523fc989…`](https://explorer.testnet.chain.robinhood.com/tx/0x523fc9896a9f0090a1924a45358b8cf0f47df5b10c67d4fce168fc4d76a9fa1c) |
| Buyer pays 3 USDG into the split | [`0xf90b5249…`](https://explorer.testnet.chain.robinhood.com/tx/0xf90b5249b7454c1c16b7f8797f369e709da235d448ac6ae281349a95d72b0d3d) |
| **`release()` — every payee credited pro-rata** | [`0x3e8fa360…`](https://explorer.testnet.chain.robinhood.com/tx/0x3e8fa360bad991c6d18fd940ea520b30dca121ef6972a543a6eba17e4ffd1c8a) |
| Producer withdraws their share (2.76 USDG) | [`0xa2b64e57…`](https://explorer.testnet.chain.robinhood.com/tx/0xa2b64e57b943366078d2d83d375d70ea976cd62ef39ced439398f0663c965323) |

Read back: `committed = true`, `feeBps = 300`, `totalReleased = 3 USDG`, and the split
contract holds exactly the contributor's unclaimed share (0.24 USDG, claimable via
`pendingBalance` — only they can `withdraw()` it). Sales ledger: 1 row.

Reproduce:

```bash
node scripts/seal-and-sell.mjs <workId> --price 3 --app-url http://localhost:3000
```

> ⚠️ `commitSplit` is **one-shot per contract** (`AlreadyCommitted`). The shared Splits
> instance is now permanently bound to Neon Requiem's table. A second work needs its own
> `CreatorFoundrySplits` deployment.

Reproduce the bounty loop on any other bounty:

```bash
# once, so the brief/delivery hashes exist:
curl "http://localhost:3000/api/bounties/<bountyId>/attest"
# then the whole producer side, for real:
node scripts/demo-loop.mjs <bountyId> --score 80 --app-url http://localhost:3000
```

The script signs `approve → fund → assignContributor → mint → release`, records every hash
through the app's API, and prints an explorer link per transaction. It refuses to run on a
bounty that isn't `delivered`, or one whose hashes are missing — the critic must actually
have scored the artifact first.

> **The one step that needs a second wallet:** `attestDelivery` is signed by the
> *contributor* (in the browser, from the delivery modal). Without it the delivery hash
> still reaches the NFT metadata and the database, but the escrow has no on-chain trigger,
> so `autoRelease` is not armed for that bounty. For a bounty where the contributor attests,
> the review-window backstop becomes live and anyone can trigger the payout.

## ⚡ FAST PATH — one command (re-deploy anytime)

The repo ships a deploy script that compiles, deploys the contracts, checks your real USDG balance, and writes `.env.local` for you.

```bash
# 1. Create a BURNER MetaMask account (testnet only — never your main wallet)
# 2. Add Arbitrum Sepolia to it (settings below) and get test ETH from a faucet
# 3. Export its private key (MetaMask → account → Account details → Export)
# 4. Put it in .env.local:
echo 'DEPLOYER_PRIVATE_KEY=0xYourBurnerKeyHere' > .env.local
# 5. Deploy:
npm run deploy
```

Select the chain explicitly (defaults to Arbitrum Sepolia):

```bash
npm run deploy robinhood-testnet    # primary demo chain
npm run deploy arbitrum-sepolia     # secondary
```

The script prints every deployed address + explorer link and writes:
`NEXT_PUBLIC_CHAIN`, `NEXT_PUBLIC_USDG_ADDRESS`, `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`,
`NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS`, `NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS`,
`FORGE_FEE_WALLET` into `.env.local`.
Then `npm run dev` and demo. That's it — the Remix path below is the manual fallback.

### The escrow address matters for the demo story

`CreatorFoundryBountyEscrow` is what makes a bounty reward real instead of promised:
the producer locks the USDG when the bounty opens, and the contract pays the
contributor on approval — or **on its own** when the review window expires. If
`NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS` is unset, the app silently falls back to a
direct producer → contributor transfer, and the escrow UI is hidden. So if the
"locked reward" pills are missing in the UI, that env var is empty.

---

## MANUAL PATH (Remix) — original 15-minute walkthrough

Follow this top to bottom. It gives you every address the app needs.

---

## STEP 0 — Which wallet?

- Use **MetaMask** (or any injected wallet).
- You need **2 accounts** in it for the demo:
  - **Account 1 → PRODUCER** (creates the project, deploys contracts, approves work, pays bounties)
  - **Account 2 → CONTRIBUTOR** (claims bounties, delivers work, receives NFTs + USDG)
  - (Right-click account → "Account details" → you can export a private key if you ever need a server signer — NOT required for the standard demo.)
- Do **NOT** use your real/main wallet with real funds for the demo. Use a fresh burner account.

---

## STEP 1 — Add the network to MetaMask

Settings → Networks → Add manually:

| Field | Value |
|---|---|
| Network name | Arbitrum Sepolia |
| RPC URL | `https://sepolia-rollup.arbitrum.io/rpc` |
| Chain ID | `421614` |
| Currency | `ETH` |
| Explorer | `https://sepolia.arbiscan.io` |

## STEP 2 — Get gas (test ETH)

Faucets (pick one):
- https://arbitrum.faucet.dev/
- https://faucet.quicknode.com/arbitrum/sepolia
- https://www.infura.io/faucet/sepolia (bridge to Arbitrum Sepolia)
- https://sepolia-faucet.pk910.de/ (PoW faucet, works always)

You need ~0.01–0.05 ETH for deployment + demo transactions.

## STEP 3 — Deploy the 3 contracts (Remix, 5 minutes)

1. Open https://remix.ethereum.org
2. Create 3 files in the `contracts/` folder of the workspace and paste each file from this repo's `contracts/src/` directory:
   - `CreatorFoundryAssetNFT.sol`
   - `CreatorFoundrySplits.sol`
   - `CreatorFoundryBountyEscrow.sol`
3. Solidity compiler: **0.8.26+**, enable optimization (200 runs).
4. Deploy tab → Environment: **"Injected Provider — MetaMask"** (make sure MetaMask is on Arbitrum Sepolia).

Deploy in this order and **copy each address immediately**:

### 3a. `CreatorFoundryAssetNFT`
- Click **Deploy** (no constructor args).
- 📋 **`NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` = <this address>**

### 3b. `CreatorFoundrySplits`
- Constructor args (3):
  - `_controller` → **your PRODUCER wallet address** (Account 1)
  - `_feeWallet` → any wallet you control (fee recipient — Account 1 is fine)
  - `_token` → the **REAL Paxos USDG testnet address** (below)
- Click **Deploy**.
- 📋 **`NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS` = <this address>**

> Note: each published work gets its own Splits instance in the full flow. For the
> demo, one instance configured via env is enough — the seal flow writes the
> split table to it.

### 3c. `CreatorFoundryBountyEscrow`
- Constructor args (1):
  - `_token` → the **REAL Paxos USDG testnet address** (same as Splits)
- Click **Deploy**.
- 📋 **`NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS` = <this address>**

Then fund the escrow from the app: open a bounty on the project board and click
**🔒 Lock reward**. The producer signs an ERC-20 `approve` (once) and then `fund`,
which moves the reward into the contract and locks the brief hash with it.

## STEP 4 — Get REAL Paxos USDG (no mocks)

Real USDG testnet contract addresses (from docs.paxos.com):
- **Arbitrum Sepolia:** `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`
- **Robinhood Testnet:** `0x7E955252E15c84f5768B83c41a71F9eba181802F`
- **Arbitrum One mainnet:** `0x004B506865409877C9fA29bfb1ebA929984B9bbC`

To obtain test USDG (per https://docs.paxos.com/guides/developer/sandbox):
1. Create a free Paxos Developer (Sandbox) account
2. Sandbox Dashboard → **Deposit** → asset **USDG**, network **Arbitrum One (Sepolia)** → copy the deposit address
3. Fund it via the **Paxos Testnet Faucet** or the Dashboard **Fund** button (USDG limit: 1,000,000 per withdrawal)
4. **Withdraw on-chain** from the Sandbox to your producer wallet
5. Optionally `Import Token` in MetaMask with the USDG testnet address so the balance is visible

Repeat the withdrawal for your CONTRIBUTOR account if you want it to hold USDG too.

## STEP 5 — Write `.env.local`

```env
NEXT_PUBLIC_CHAIN=arbitrum-sepolia
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=0x<PASTE 3a>
NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS=0x<PASTE 3b>
NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS=0x<PASTE 3c>
NEXT_PUBLIC_USDG_ADDRESS=0x<from STEP 4>
FORGE_FEE_WALLET=0x<your fee wallet = Account 1 is fine>
```
Restart `npm run dev` after creating the file.

---

## STEP 6b — Demo the escrow SLA (the strongest 90 seconds in the demo)

This is the part that proves the money is not a promise. Two browser windows:
producer (Account 1) and contributor (Account 2).

1. **Producer** opens a project → clicks **🔒 Lock reward** on a bounty and picks
   the **5 minutes (live demo)** option for *both* windows. The reward is now
   inside the escrow contract — `escrows(key)` on the explorer shows the balance.
2. **Contributor** opens `/artist`. The task card says **"2.5 USDG locked"** above
   the Accept button — the guarantee is visible *before* committing any work.
3. Contributor claims, then submits a deliverable. Their wallet signs
   `attestDelivery`, which hashes the artifact and starts the producer's review
   clock.
4. **Now the producer does nothing.** Do not click Approve. Wait out the 5 minutes.
5. The contributor's card flips to **"review window closed — you can take payment
   now"** and a **Claim payment (SLA)** button appears. They click it. This is
   `autoRelease`, and it is callable by anyone — no producer signature anywhere.
6. The USDG lands in the contributor's wallet and the card shows **paid
   (SLA auto-release)**.

For the recorded demo you can do step 4 with a normal 72-hour review window and
just narrate it, or use the 5-minute window and let the clock run on camera —
cutting to the release is honest either way, but the second version is stronger.

The inverse guarantee is on the same contract: if the contributor never delivers
before the delivery window expires, **Refund** returns the reward to the producer.

---

## STEP 6 — Robinhood Chain Testnet (secondary — do after the Arbitrum demo works)

| Field | Value |
|---|---|
| Network name | Robinhood Chain Testnet |
| RPC URL | `https://rpc.testnet.chain.robinhood.com` |
| Chain ID | `46630` |
| Currency | `ETH` |
| Explorer | `https://explorer.testnet.chain.robinhood.com` |

- Faucet: https://faucet.testnet.chain.robinhood.com/
- Deploy the same 3 contracts the same way (Injected Provider on Robinhood testnet).
- USDG on Robinhood testnet (real Paxos): `0x7E955252E15c84f5768B83c41a71F9eba181802F`
  — obtain it via the Paxos Sandbox flow in STEP 4.
- Switch app: set `NEXT_PUBLIC_CHAIN=robinhood-testnet` and restart.

---

## Wallets used by the app (summary)

| Env var | Wallet | Who signs |
|---|---|---|
| *(browser)* | Producer wallet (Account 1) | Creates project, **locks bounty rewards in escrow**, approves → **mints NFT to contributor**, **releases the escrow**, seals split table, buys copies |
| *(browser)* | Contributor wallet (Account 2) | Claims bounty, delivers assets, **attests the delivery hash**, **auto-releases the escrow if the producer goes quiet**, withdraws USDG |
| `FORGE_PRIVATE_KEY` *(optional)* | Server signer | Only needed for server-side txs — leave unset for the demo |
| `FORGE_FEE_WALLET` | Fee recipient | Receives the 3% platform fee in splits |

## Where addresses appear in the app

| Env var | Used by |
|---|---|
| `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS` | Approve → mint (ERC-721 + ERC-2981) |
| `NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS` | Store buys (USDG → splits contract), seal |
| `NEXT_PUBLIC_USDG_ADDRESS` | Bounty payouts + copy purchases |
| `NEXT_PUBLIC_CHAIN` | Picks Arbitrum Sepolia vs Robinhood testnet everywhere |
