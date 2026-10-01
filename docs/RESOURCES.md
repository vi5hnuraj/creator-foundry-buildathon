# Creator Foundry — Resources

Everything external this project depends on or has been verified against, plus the reading that
informed the design. Addresses and links were verified **September 2026**.

---

## 1. Chains

| Chain | Chain ID | Role in this project | RPC | Explorer |
|---|---|---|---|---|
| **Arbitrum Sepolia** | 421614 | Buildathon home chain; all three contracts deployed | `https://sepolia-rollup.arbitrum.io/rpc` | https://sepolia.arbiscan.io |
| **Robinhood Chain Testnet** | 46630 | Arbitrum Orbit chain; the chain used to prove the full loop end-to-end | `https://rpc.testnet.chain.robinhood.com` | https://explorer.testnet.chain.robinhood.com |

Chain operators:
- Arbitrum docs — https://docs.arbitrum.io
- Arbitrum Sepolia public RPCs — https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info
- Robinhood Chain — https://docs.robinhood.com/chain (Orbit chain reference)

## 2. Faucets

| Need | Source |
|---|---|
| Arbitrum Sepolia ETH | https://arbitrum.faucet.dev/ |
| Arbitrum Sepolia ETH | https://faucet.quicknode.com/arbitrum/sepolia |
| Arbitrum Sepolia ETH (PoW, no signup) | https://sepolia-faucet.pk910.de/ |
| Testnet USDG | Hackathon Discord, or the Paxos sandbox dashboard (Deposit → USDG → Sepolia) |
| Balance check | `npm run check:usdg` |

## 3. Deployed contracts

Recorded per chain in [`contracts/deployments.json`](../contracts/deployments.json) — that file, not this doc, is the
source of truth. `npm run verify` re-reads all of them.

### Robinhood Chain Testnet (46630)

| Contract | Address |
|---|---|
| `CreatorFoundryAssetNFT` (ERC-721 + ERC-2981) | `0xb176b9ea780c534c47c15a9651f7af1b80302b10` |
| `CreatorFoundrySplits` (USDG distributor) | `0x66ffff1d5bd5cd41e4cd9695875f1e8e96bdd845` |
| `CreatorFoundryBountyEscrow` | `0x6390674fe1ac130c145299396a5441510d052062` |
| Paxos USDG (real, no mock) | `0x7E955252E15c84f5768B83c41a71F9eba181802F` |

### Arbitrum Sepolia (421614)

| Contract | Address |
|---|---|
| `CreatorFoundryAssetNFT` | `0xd63401c8b86c5baa85e4af0e141c4bb55cf4f5ca` |
| `CreatorFoundrySplits` | `0x381f563514b264e7142bd3ea090e34350c0e6693` |
| `CreatorFoundryBountyEscrow` | `0x0a002725a40c46fcdbc7cca488f6469b8203ce96` |
| Paxos USDG | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` |

Arbitrum One mainnet USDG (roadmap reference): `0x004B506865409877C9fA29bfb1ebA929984B9bbC`

## 4. Stablecoin — Paxos USDG

- Paxos Global Dollar — https://www.paxos.com/usdg
- USDG documentation and contract addresses — https://docs.paxos.com
- Decimals: **6**. Treat all USDG amounts as bigint base units at the boundaries; convert through
  `parseUsdg` / `formatUsdg`.

Why a stablecoin: creative labour is priced in fiat. Denominated payouts in dollars remove the
"what is this worth when it lands" objection that otherwise kills crypto payment adoption with real
producers.

## 5. Token standards

- ERC-721 — https://eips.ethereum.org/EIPS/eip-721
- ERC-2981 (royalty standard used by `CreatorFoundryAssetNFT`) — https://eips.ethereum.org/EIPS/eip-2981
- ERC-20 — https://eips.ethereum.org/EIPS/eip-20
- OpenZeppelin Contracts (ERC721URIStorage, ERC2981, Ownable, ReentrancyGuard) — https://docs.openzeppelin.com/contracts/5.x

## 6. Prior art we studied

- **0xSplits** — https://docs.splits.org — the reference model for immutable, permissionless revenue
  distribution. `CreatorFoundrySplits` follows the same principle (fixed payout table, anyone can
  trigger a release) while denominating payouts in an ERC-20 and capping the platform fee on-chain.
- **Sablier / Superfluid** — https://docs.sablier.com · https://docs.superfluid.finance — continuous
  payment streams, a different answer to the same "creator isn't paid" problem.
- **Kleros / Aragon Court** — https://kleros.io — decentralized arbitration; our alternative is to
  avoid needing a judge at all by making each side's deadline automatically decisive.
- **Gitcoin / Optimism RetroPGF** — retrospective funding of public goods, the opposite temporal
  model to the one this project uses (fund first, work second).

The design deliberately takes 0xSplits' immutable-distribution idea and pairs it with an escrow that
has **two** deadlines, because a single-timer escrow lets either side profit from silence.

## 7. Toolchain documentation

| Tool | Docs | Used for |
|---|---|---|
| Next.js 14 (App Router) | https://nextjs.org/docs | the app and its API routes |
| React 18 | https://react.dev | UI |
| TypeScript | https://www.typescriptlang.org/docs | all application code |
| wagmi | https://wagmi.sh | wallet/chain bindings |
| viem | https://viem.sh | encoding, reads, writes |
| RainbowKit | https://www.rainbowkit.com/docs | connect-wallet UX |
| Tailwind CSS | https://tailwindcss.com/docs | styling |
| Supabase | https://supabase.com/docs | optional Postgres + object storage |
| Solidity | https://docs.soliditylang.org | contracts |
| solc (npm `solc`) | https://www.npmjs.com/package/solc | compile in `scripts/deploy.mjs` |
| FastAPI | https://fastapi.tiangolo.com | the critic service |
| PyTorch | https://pytorch.org/docs | critic training/inference |
| CLIP (OpenAI) | https://github.com/openai/CLIP | frozen backbone for the critic |
| Pillow | https://pillow.readthedocs.io | image handling in the critic |

## 8. Hackathon

- Arbitrum Open House Singapore — **Online Buildathon**, HackQuest
- Submission deadline: **1 October 2026, 11:59 PM SGT**
- Two videos are required by the project setup form: a **Demo Video** and a **Pitch Video**
  (see [SUBMISSION.md](SUBMISSION.md))

## 9. Repo documentation index

| Doc | Read it for |
|---|---|
| [README.md](../README.md) | the pitch and verifiable results |
| [OVERVIEW.md](OVERVIEW.md) | the product and user journey |
| [ARCHITECTURE.md](ARCHITECTURE.md) | system design and module map |
| [SETUP_GUIDE.md](SETUP_GUIDE.md) | getting it running |
| [DEVELOPMENT.md](DEVELOPMENT.md) | conventions and extension recipes |
| [DEPLOYMENT.md](DEPLOYMENT.md) | deploying and verifying contracts |
| [WHITEPAPER.md](WHITEPAPER.md) | protocol and economic model |
| [SUBMISSION.md](SUBMISSION.md) | form copy and video scripts |
| [services/critic/README.md](../services/critic/README.md) | the trained critic |
