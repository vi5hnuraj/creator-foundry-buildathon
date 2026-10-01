#!/usr/bin/env node
/**
 * VERIFY EVERYTHING ON-CHAIN — read-only, no private key, no writes.
 *
 *   node scripts/verify-onchain.mjs
 *
 * Checks, against the live Robinhood Chain Testnet (the active demo chain):
 *   1. every contract has real bytecode
 *   2. every transaction hash in the local database EXISTS on-chain and succeeded
 *   3. the bounty escrow's state for each bounty (locked / released / score)
 *   4. who owns each minted NFT
 *   5. USDG balances of the producer and contributor wallets
 *   6. the revenue split: committed table, fee, what has been released, who can claim
 *   7. the multi-chain surface — every chain in deployments.json, which contracts
 *      are live there and whether each escrow settles in that chain's USDG
 *
 * Addresses come from deployments.json (per chain), not hardcoded constants, so
 * this cannot drift from what the app actually talks to.
 *
 * Anything it cannot confirm is printed as ❌ with the reason. Nothing is mocked,
 * nothing is written — if this script says a transaction is real, you can open the
 * explorer link and see it yourself.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256, toBytes, formatUnits, parseAbi } from "viem";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
dotenv.config({ path: resolve(ROOT, ".env.local") });

// The chain the app is pointed at right now — the one the database's tx hashes
// and escrow state belong to.
const REGISTRY = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments.json"), "utf8"));
const ACTIVE_KEY = process.env.NEXT_PUBLIC_CHAIN || "robinhood-testnet";
const ACTIVE = REGISTRY.chains[ACTIVE_KEY];
if (!ACTIVE) {
  console.error(`❌ deployments.json has no entry for "${ACTIVE_KEY}"`);
  process.exit(1);
}

const RPC = ACTIVE.rpc || chainRpc(ACTIVE_KEY);
const EXPLORER = ACTIVE.explorer;

/** RPC endpoints live in the deploy script's chain table; mirror them here. */
function chainRpc(key) {
  return key === "arbitrum-sepolia"
    ? "https://sepolia-rollup.arbitrum.io/rpc"
    : "https://rpc.testnet.chain.robinhood.com";
}

// Active chain's contracts, from the registry (never hardcoded here).
const CONTRACTS = {
  CreatorFoundryAssetNFT: ACTIVE.nft,
  CreatorFoundrySplits: ACTIVE.splits,
  CreatorFoundryBountyEscrow: ACTIVE.escrow,
  "USDG (Paxos, real)": ACTIVE.usdg,
};
const PRODUCER = "0x79E41C5ba4fd8B6Fdf3E23C41F8429E71981AB3B";
const CONTRIBUTOR = "0x1d980b574D51044e57c8feE0Bc7d85BB70534061";

const client = createPublicClient({ transport: http(RPC) });

const ABI = {
  erc20: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function name() view returns (string)",
  ]),
  nft: parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function nextTokenId() view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
  ]),
  escrow: parseAbi([
    "function token() view returns (address)",
    "function MIN_WINDOW() view returns (uint64)",
    "function escrows(bytes32) view returns (address,address,uint256,uint64,uint64,uint64,bool,bool,bool,bytes32,bytes32,uint16)",
    "function releasable(bytes32) view returns (bool)",
  ]),
  splits: parseAbi([
    "function token() view returns (address)",
    "function committed() view returns (bool)",
    "function feeBps() view returns (uint32)",
    "function totalReleased() view returns (uint256)",
    "function pendingBalance(address) view returns (uint256)",
    "function payees(uint256) view returns (address)",
    "function weights(address) view returns (uint32)",
  ]),
};

let pass = 0;
let fail = 0;
const ok = (msg) => {
  pass++;
  console.log(`  ✅ ${msg}`);
};
const bad = (msg) => {
  fail++;
  console.log(`  ❌ ${msg}`);
};
const info = (msg) => console.log(`     ${msg}`);

async function main() {
  console.log("\n🔎 CREATOR FOUNDRY — on-chain verification");
  console.log(`   RPC: ${RPC}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // ---------------------------------------------------------------- 1
  console.log(`1) CONTRACTS HAVE REAL CODE  (active chain: ${ACTIVE.label}, ${ACTIVE.chainId})`);
  for (const [name, addr] of Object.entries(CONTRACTS)) {
    if (!addr) {
      bad(`${name} — not deployed on ${ACTIVE.label}`);
      continue;
    }
    const code = await client.getBytecode({ address: addr }).catch(() => null);
    const size = code ? code.length / 2 - 1 : 0;
    if (size > 0) ok(`${name} — ${size} bytes`);
    else bad(`${name} — NO CODE AT ${addr}`);
    info(`${EXPLORER}/address/${addr}`);
  }

  // ---------------------------------------------------------------- 2
  console.log("\n2) CONTRACT CONFIGURATION");
  const usdgDecimals = await client.readContract({ address: CONTRACTS["USDG (Paxos, real)"], abi: ABI.erc20, functionName: "decimals" });
  usdgDecimals === 6 ? ok(`USDG.decimals = 6`) : bad(`USDG.decimals = ${usdgDecimals}, expected 6`);

  const nftName = await client.readContract({ address: CONTRACTS.CreatorFoundryAssetNFT, abi: ABI.nft, functionName: "name" });
  const nftSym = await client.readContract({ address: CONTRACTS.CreatorFoundryAssetNFT, abi: ABI.nft, functionName: "symbol" });
  ok(`NFT is "${nftName}" (${nftSym})`);

  const escrowToken = await client.readContract({ address: CONTRACTS.CreatorFoundryBountyEscrow, abi: ABI.escrow, functionName: "token" });
  escrowToken.toLowerCase() === CONTRACTS["USDG (Paxos, real)"].toLowerCase()
    ? ok("Escrow settles in real USDG")
    : bad(`Escrow token is ${escrowToken}`);

  const splitsToken = await client.readContract({ address: CONTRACTS.CreatorFoundrySplits, abi: ABI.splits, functionName: "token" });
  splitsToken.toLowerCase() === CONTRACTS["USDG (Paxos, real)"].toLowerCase()
    ? ok("Splits settle in real USDG")
    : bad(`Splits token is ${splitsToken}`);

  // ---------------------------------------------------------------- 3
  console.log("\n3) EVERY TRANSACTION HASH IN THE LOCAL DATABASE");
  const dbPath = resolve(ROOT, "data/local/.creator-foundry-db.json");
  if (!existsSync(dbPath)) {
    info("no .creator-foundry-db.json — skipping");
  } else {
    const db = JSON.parse(readFileSync(dbPath, "utf8"));
    const seen = new Map();
    db.bounties.forEach((b) =>
      ["tx_hash", "payment_tx_hash", "escrow_tx", "escrow_assign_tx", "escrow_release_tx", "attest_tx"].forEach((k) => {
        if (b[k]) seen.set(b[k], `bounty [${k}] ${String(b.title).slice(0, 30)}`);
      })
    );
    db.works.forEach((w) => {
      if (w.seal_tx_hash) seen.set(w.seal_tx_hash, `work NFT: ${w.title}`);
      if (w.split_tx_hash) seen.set(w.split_tx_hash, `commitSplit: ${w.title}`);
    });
    db.sales.forEach((s) => {
      if (s.tx_hash) seen.set(s.tx_hash, `sale ${s.id}`);
    });

    if (seen.size === 0) info("no transactions recorded yet");
    for (const [hash, label] of seen) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r.status === "success") ok(`block ${Number(r.blockNumber)} — ${label}`);
        else bad(`status=${r.status} — ${label}`);
        info(`${EXPLORER}/tx/${hash}`);
      } catch {
        bad(`DOES NOT EXIST ON CHAIN: ${hash}  (${label})`);
      }
    }
    info(`${seen.size} hashes checked`);

    // -------------------------------------------------------------- 4
    console.log("\n4) NFT OWNERSHIP");
    const nextId = Number(await client.readContract({ address: CONTRACTS.CreatorFoundryAssetNFT, abi: ABI.nft, functionName: "nextTokenId" }));
    info(`nextTokenId = ${nextId} (so ${nextId} token(s) exist, ids start at 0)`);
    for (let i = 0; i < nextId; i++) {
      const owner = await client.readContract({ address: CONTRACTS.CreatorFoundryAssetNFT, abi: ABI.nft, functionName: "ownerOf", args: [BigInt(i)] });
      const isContrib = owner.toLowerCase() === CONTRIBUTOR.toLowerCase();
      if (isContrib) ok(`token ${i} owned by the contributor`);
      else ok(`token ${i} owned by ${owner}`);
      info(`${EXPLORER}/token/${CONTRACTS.CreatorFoundryAssetNFT}?a=${i}`);
    }

    // -------------------------------------------------------------- 5
    console.log("\n5) BOUNTY ESCROW STATE");
    let funded = 0;
    for (const b of db.bounties) {
      const e = await client.readContract({
        address: CONTRACTS.CreatorFoundryBountyEscrow,
        abi: ABI.escrow,
        functionName: "escrows",
        args: [keccak256(toBytes(b.id))],
      });
      if (e[3] === 0n) continue;
      funded++;
      const released = e[7];
      console.log(`  • ${String(b.title).slice(0, 42)}`);
      ok(`locked ${formatUnits(e[2], 6)} USDG, released=${released}, criticScore=${e[11]}, attested=${e[6]}`);
      info(`locked in escrow by ${e[0]}, for ${e[1]}`);
      if (Number(e[11]) > 0 && released) ok(`the payout carries the on-chain critic score`);
    }
    if (funded === 0) info("no bounty has ever been funded in escrow (nothing to check)");

    // -------------------------------------------------------------- 6
    console.log("\n6) REVENUE SPLIT (the royalty side)");
    const committed = await client.readContract({ address: CONTRACTS.CreatorFoundrySplits, abi: ABI.splits, functionName: "committed" });
    const feeBps = await client.readContract({ address: CONTRACTS.CreatorFoundrySplits, abi: ABI.splits, functionName: "feeBps" });
    const released = await client.readContract({ address: CONTRACTS.CreatorFoundrySplits, abi: ABI.splits, functionName: "totalReleased" });
    if (committed) ok(`split table committed on-chain (feeBps=${feeBps} = ${Number(feeBps) / 100}%)`);
    else info("split table not committed (no work sealed against this contract yet)");
    info(`total released through the split: ${formatUnits(released, 6)} USDG`);
    for (const [who, addr] of [["producer", PRODUCER], ["contributor", CONTRIBUTOR]]) {
      const pending = await client.readContract({ address: CONTRACTS.CreatorFoundrySplits, abi: ABI.splits, functionName: "pendingBalance", args: [addr] });
      info(`${who} can still withdraw ${formatUnits(pending, 6)} USDG`);
    }
  }

  // ---------------------------------------------------------------- 7
  console.log("\n7) WALLET BALANCES (real USDG)");
  for (const [who, addr] of [["producer", PRODUCER], ["contributor", CONTRIBUTOR]]) {
    const bal = await client.readContract({ address: CONTRACTS["USDG (Paxos, real)"], abi: ABI.erc20, functionName: "balanceOf", args: [addr] });
    ok(`${who} (${addr.slice(0, 10)}…) holds ${formatUnits(bal, 6)} USDG`);
  }

  // ---------------------------------------------------------------- 8
  // The full deployment surface, per chain — so "is this on MY chain?" has an
  // answer that doesn't depend on which RPC the demo happens to be using.
  console.log("\n8) DEPLOYMENT SURFACE ACROSS CHAINS (deployments.json)");
  for (const [key, d] of Object.entries(REGISTRY.chains)) {
    const c = createPublicClient({ transport: http(d.rpc || chainRpc(key)) });
    const parts = [];
    for (const [label, addr] of [["NFT", d.nft], ["Splits", d.splits], ["Escrow", d.escrow]]) {
      if (!addr) {
        parts.push(`${label} …not deployed`);
        continue;
      }
      const code = await c.getBytecode({ address: addr }).catch(() => null);
      const size = code ? code.length / 2 - 1 : 0;
      parts.push(`${label} ${size > 0 ? `${size}B` : "NO CODE"}`);
    }
    const marker = key === ACTIVE_KEY ? "★ active" : "      ";
    console.log(`  ${marker}  ${d.label.padEnd(24)} ${parts.join("  ·  ")}`);
    if (d.escrow) {
      // The escrow must settle in the USDG that exists on ITS chain.
      const token = await c
        .readContract({ address: d.escrow, abi: ABI.escrow, functionName: "token" })
        .catch(() => null);
      if (token && token.toLowerCase() === d.usdg.toLowerCase()) {
        ok(`${d.label}: escrow settles in that chain's USDG`);
      } else {
        bad(`${d.label}: escrow token ${token} != registry usdg ${d.usdg}`);
      }
      info(`${d.explorer}/address/${d.escrow}`);
    } else {
      info(`${d.label}: escrow not deployed — run \`npm run deploy ${key}\``);
    }
  }

  // ----------------------------------------------------------------
  console.log("\n" + "=".repeat(62));
  console.log(`RESULT: ${pass} checks passed, ${fail} failed`);
  if (fail === 0) console.log("Everything stored is verifiable on-chain. ✅");
  else console.log("Something above could not be confirmed on-chain. ❌");
  console.log("");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ verification script error: ${e.message}\n`);
  process.exit(1);
});
