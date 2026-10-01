#!/usr/bin/env node
/**
 * REAL ESCROW LOOP — drives the producer's side of a bounty end to end on-chain.
 *
 * Usage:
 *   node scripts/demo-loop.mjs <bountyId> [--score 78] [--app-url http://localhost:3000]
 *                              [--delivery-window 604800] [--review-window 259200]
 *
 * What it signs, in order (all with DEPLOYER_PRIVATE_KEY from .env.local):
 *   1. USDG approve  → the escrow, for the bounty amount (skipped if already sufficient)
 *   2. escrow.fund   → locks the reward + the brief hash
 *   3. escrow.assignContributor → names the contributor, starts both SLA clocks
 *   4. NFT mint      → proof-of-authorship to the contributor (reads the real token id
 *                      out of the AssetMinted event)
 *   5. escrow.release → pays the contributor, stamping the critic score
 *
 * Then it records every hash through the app's API so the UI shows the same
 * truth the chain does. Prints an explorer link per transaction.
 *
 * PREREQUISITES the script refuses to guess:
 *   - the bounty must be 'delivered' with claimed_by set
 *   - `bounty.brief_hash` and `bounty.delivery_hash` must already exist
 *     (call GET /api/bounties/:id/attest once — that computes and caches them)
 *
 * The private key is read from .env.local and never printed.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  parseAbi,
  decodeEventLog,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
dotenv.config({ path: resolve(ROOT, ".env.local") });

const RPC = "https://rpc.testnet.chain.robinhood.com";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const CHAIN_ID = 46630;

const args = process.argv.slice(2);
const bountyId = args.find((a) => !a.startsWith("--"));
function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const APP_URL = flag("app-url", "http://localhost:3000");
const SCORE = Number(flag("score", "0"));
const DELIVERY_WINDOW = Number(flag("delivery-window", String(7 * 24 * 3600)));
const REVIEW_WINDOW = Number(flag("review-window", String(72 * 3600)));

if (!bountyId) {
  console.error("usage: node scripts/demo-loop.mjs <bountyId> [--score N] [--app-url URL]");
  process.exit(1);
}

function die(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Config from .env.local (written by scripts/deploy.mjs)
// ---------------------------------------------------------------------------
const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  die("DEPLOYER_PRIVATE_KEY missing from .env.local — the producer's key is required to sign.");
}
const USDG = process.env.NEXT_PUBLIC_USDG_ADDRESS;
const NFT = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS;
const ESCROW = process.env.NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS;
for (const [name, v] of [["NEXT_PUBLIC_USDG_ADDRESS", USDG], ["NEXT_PUBLIC_NFT_CONTRACT_ADDRESS", NFT], ["NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS", ESCROW]]) {
  if (!v) die(`${name} is not set in .env.local — run \`npm run deploy robinhood-testnet\` first.`);
}

const account = privateKeyToAccount(key);
const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

// USDG + mint ABI
const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const ESCROW_ABI = parseAbi([
  "function fund(bytes32 key, uint256 amount, bytes32 briefHash)",
  "function assignContributor(bytes32 key, address contributor, uint64 deliveryWindow, uint64 reviewWindow)",
  "function attestDelivery(bytes32 key, bytes32 deliveryHash)",
  "function release(bytes32 key, uint16 criticScore)",
  "function autoRelease(bytes32 key)",
  "function refund(bytes32 key)",
  "function releasable(bytes32 key) view returns (bool)",
  "function escrows(bytes32) view returns (address,address,uint256,uint64,uint64,uint64,bool,bool,bool,bytes32,bytes32,uint16)",
  "event BountyFunded(bytes32 indexed key, address indexed producer, uint256 amount, bytes32 briefHash)",
  "event BountyReleased(bytes32 indexed key, address indexed contributor, address indexed reviewer, uint256 amount, bytes32 briefHash, bytes32 deliveryHash, uint16 criticScore, bool automatic)",
]);
const NFT_ABI = parseAbi([
  "function mint(address to, string uri, address royaltyReceiver, uint96 royaltyBps) returns (uint256)",
  "event AssetMinted(uint256 indexed tokenId, address indexed to, address indexed royaltyReceiver, uint96 royaltyBps)",
]);

function log(msg) {
  console.log(msg);
}

async function send(label, txArgs) {
  const hash = await wallet.writeContract({ ...txArgs, account });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`${label} reverted (tx ${hash})`);
  log(`   ✅ ${label}`);
  log(`      ${EXPLORER}/tx/${hash}   (gas ${Number(receipt.gasUsed)}, block ${Number(receipt.blockNumber)})`);
  return { hash, receipt };
}

async function api(path, body) {
  try {
    const res = await fetch(`${APP_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) log(`   ⚠️  app API ${path} → ${res.status} ${json.error ?? ""}`);
    return json;
  } catch (e) {
    log(`   ⚠️  app API ${path} unreachable (${e.message}) — chain state is still correct`);
    return null;
  }
}

async function main() {
  log(`\n🔥 Real escrow loop — Robinhood Chain Testnet`);
  log("=".repeat(64));
  log(`Producer:  ${account.address}`);
  log(`Escrow:    ${ESCROW}`);
  log(`Bounty:    ${bountyId}`);

  // --- Load the bounty from the app's database ---------------------------
  const dbPath = resolve(ROOT, "data/local/.creator-foundry-db.json");
  if (!existsSync(dbPath)) die(".creator-foundry-db.json not found — start the app once first.");
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const bounty = db.bounties.find((b) => b.id === bountyId);
  if (!bounty) die(`Bounty ${bountyId} not found in the local database.`);
  if (!bounty.claimed_by) die("Bounty has no claimed_by — the contributor must claim it first.");
  if (!bounty.brief_hash) die("bounty.brief_hash missing — call GET /api/bounties/:id/attest once.");
  if (!bounty.delivery_hash) die("bounty.delivery_hash missing — call GET /api/bounties/:id/attest once.");

  const contributor = bounty.claimed_by;
  const amount = BigInt(Math.round(Number(bounty.reward_eth) * 1e6)); // USDG: 6 decimals
  const briefHash = bounty.brief_hash;
  const deliveryHash = bounty.delivery_hash;
  const key32 = keccak256(toBytes(bountyId));

  log(`Contributor: ${contributor}`);
  log(`Reward:    ${formatUnits(amount, 6)} USDG`);
  log(`BriefHash: ${briefHash}`);
  log(`DelivHash: ${deliveryHash}`);
  log(`Windows:   ${DELIVERY_WINDOW}s to deliver / ${REVIEW_WINDOW}s to review\n`);

  if (SCORE < 0 || SCORE > 100) die(`--score must be 0–100 (got ${SCORE})`);

  const eth = await pub.getBalance({ address: account.address });
  if (eth === 0n) die(`Producer has no testnet ETH for gas — fund ${account.address}`);
  const usdgBal = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (usdgBal < amount) die(`Producer holds ${formatUnits(usdgBal, 6)} USDG, needs ${formatUnits(amount, 6)}.`);

  // struct: producer, contributor, amount, fundedAt, deliveryDeadline,
  //         reviewDeadline, attested, released, refunded, briefHash, deliveryHash, criticScore
  const before = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "escrows", args: [key32] });
  const alreadyFunded = before[3] > 0n && !before[8];

  // --- 1. approve the escrow for the exact amount -------------------------
  // Skipped when the reward is already locked: a previous fund() consumed the
  // allowance, so re-approving would just burn gas for nothing.
  log("1) Approving USDG for the escrow");
  if (alreadyFunded) {
    log("   ⏭  reward already locked — no approval needed");
  } else {
    const allowance = await pub.readContract({ address: USDG, abi: ERC20, functionName: "allowance", args: [account.address, ESCROW] });
    if (allowance >= amount) {
      log(`   ⏭  allowance already ${formatUnits(allowance, 6)} USDG — no approval needed`);
    } else {
      await send(`approved ${formatUnits(amount, 6)} USDG`, {
        address: USDG,
        abi: ERC20,
        functionName: "approve",
        args: [ESCROW, amount],
      });
    }
  }

  // --- 2. lock the reward + brief hash ------------------------------------
  log("2) Locking the reward in escrow");
  if (alreadyFunded) {
    log(`   ⏭  already funded with ${formatUnits(before[2], 6)} USDG`);
  } else {
    const { hash: fundTx } = await send(`escrow.fund(${formatUnits(amount, 6)} USDG + brief hash)`, {
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "fund",
      args: [key32, amount, briefHash],
    });
    await api(`/api/bounties/${bountyId}/escrow`, {
      wallet: account.address,
      action: "fund",
      txHash: fundTx, // the real hash — never a placeholder
      briefHash,
      deliveryWindowSeconds: DELIVERY_WINDOW,
      reviewWindowSeconds: REVIEW_WINDOW,
    });
  }

  // --- 3. assign the contributor, starting both clocks --------------------
  log("3) Naming the contributor and starting the SLA clocks");
  const mid = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "escrows", args: [key32] });
  if (mid[1] !== "0x0000000000000000000000000000000000000000") {
    log(`   ⏭  contributor already assigned (${mid[1]})`);
  } else {
    const { hash } = await send(`assignContributor(${contributor.slice(0, 10)}…)`, {
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "assignContributor",
      args: [key32, contributor, BigInt(DELIVERY_WINDOW), BigInt(REVIEW_WINDOW)],
    });
    await api(`/api/bounties/${bountyId}/escrow`, { wallet: account.address, action: "assign", txHash: hash });
  }

  // --- 4. mint the proof-of-authorship NFT --------------------------------
  log("4) Minting the proof-of-authorship NFT");
  let tokenId = bounty.token_id ?? null;
  let mintTx = bounty.tx_hash ?? null;
  if (mintTx) {
    log(`   ⏭  already minted (tx ${mintTx.slice(0, 12)}…, token ${tokenId})`);
  } else {
    const uri = `${APP_URL}/api/metadata/${bountyId}`;
    const { hash, receipt } = await send("NFT minted to contributor (ERC-2981 10%)", {
      address: NFT,
      abi: NFT_ABI,
      functionName: "mint",
      args: [contributor, uri, contributor, 1000n],
    });
    mintTx = hash;
    // The real token id only exists in the event — never guess it.
    for (const l of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: NFT_ABI, data: l.data, topics: l.topics });
        if (decoded.eventName === "AssetMinted") tokenId = String(decoded.args.tokenId);
      } catch {
        /* not our event */
      }
    }
    log(`      token id: ${tokenId ?? "UNKNOWN (event not found)"}`);
  }

  // --- 5. release the escrow, stamping the critic score -------------------
  log("5) Releasing the escrow to the contributor");
  const pre = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "escrows", args: [key32] });
  let releaseTx = bounty.escrow_release_tx ?? null;
  if (pre[7]) {
    log("   ⏭  escrow already released");
  } else {
    if (pre[6]) {
      log("   ⏭  delivery already attested on-chain");
    } else {
      log("   ℹ️  no on-chain attestation (needs the contributor's wallet).");
      log("      release() does not require it — the payout is unaffected.");
    }
    const { hash } = await send(`escrow.release(criticScore=${SCORE})`, {
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "release",
      args: [key32, SCORE],
    });
    releaseTx = hash;
  }

  // --- record the whole thing in the app ---------------------------------
  log("6) Recording the approval in the app");
  // The approve route only accepts a bounty still in 'delivered' (it is the
  // approval transition). On a re-run the record already exists, so the escrow
  // release is recorded on its own — that endpoint has no state precondition.
  if (bounty.status === "delivered") {
    await api(`/api/bounties/${bountyId}/approve`, {
      wallet: account.address,
      assetContract: NFT,
      txHash: mintTx ?? undefined,
      tokenId: tokenId ?? undefined,
      escrowReleaseTx: releaseTx ?? undefined,
      escrowReleaseKind: "release",
      escrowReleaseScore: SCORE,
      briefHash,
      deliveryHash,
    });
  } else {
    log(`   ⏭  bounty already '${bounty.status}' — approval record exists`);
  }
  if (releaseTx) {
    await api(`/api/bounties/${bountyId}/escrow`, {
      wallet: account.address,
      action: "release",
      txHash: releaseTx,
      criticScore: SCORE,
    });
  }

  // --- final on-chain read-back ------------------------------------------
  const after = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "escrows", args: [key32] });
  const contribBal = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [contributor] });
  log("\n" + "=".repeat(64));
  log("✅ LOOP COMPLETE — read back from the chain:");
  log(`   escrow.released        : ${after[7]}`);
  log(`   escrow.criticScore     : ${after[11]}`);
  log(`   contributor USDG balance: ${formatUnits(contribBal, 6)}`);
  if (mintTx) log(`   NFT mint tx            : ${EXPLORER}/tx/${mintTx}`);
  if (releaseTx) log(`   escrow release tx      : ${EXPLORER}/tx/${releaseTx}`);
  log("");
}

main().catch((e) => die(e.message ?? String(e)));
