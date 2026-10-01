#!/usr/bin/env node
/**
 * REAL SEAL + SALE + SPLIT PAYOUT — proves the royalty half of the platform.
 *
 * Usage:
 *   node scripts/seal-and-sell.mjs <workId> [--price 3] [--app-url http://localhost:3000]
 *
 * Transactions, in order (all signed by DEPLOYER_PRIVATE_KEY = the producer):
 *   1. mint the work NFT        (the published release, 5% resale royalty)
 *   2. commitSplit              (the immutable USDG payout table — the step that
 *                                makes the storefront payable at all)
 *   3. USDG transfer            (the producer BUYS a copy: buyer → splits contract)
 *   4. release()                (credits every payee pro-rata, permissionlessly)
 *   5. withdraw()               (producer pulls their own share — real transfer out)
 *
 * The payee table is fetched from GET /api/works/:id/split so the on-chain
 * weights come from buildRevenueSplit, not a second implementation.
 *
 * The contributor's share is credited on-chain by release() and stays claimable
 * until THEY call withdraw() from their own wallet — this script cannot move
 * their money, by design.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  decodeEventLog,
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
const workId = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APP_URL = flag("app-url", "http://localhost:3000");
const PRICE = Number(flag("price", "3"));
const FEE_MODE = flag("fee-mode", "absorb");
const COVER = flag("cover", resolve(ROOT, "services/critic/noir_final.png"));

if (!workId) {
  console.error("usage: node scripts/seal-and-sell.mjs <workId> [--price 3] [--app-url URL]");
  process.exit(1);
}

const die = (m) => {
  console.error(`\n❌ ${m}\n`);
  process.exit(1);
};

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) die("DEPLOYER_PRIVATE_KEY missing from .env.local");
const USDG = process.env.NEXT_PUBLIC_USDG_ADDRESS;
const NFT = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS;
if (!USDG || !NFT) die("USDG/NFT addresses missing — run `npm run deploy` first.");

const account = privateKeyToAccount(key);
const chain = {
  id: CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);
const NFT_ABI = parseAbi([
  "function mint(address to, string uri, address royaltyReceiver, uint96 royaltyBps) returns (uint256)",
  "event AssetMinted(uint256 indexed tokenId, address indexed to, address indexed royaltyReceiver, uint96 royaltyBps)",
]);
const SPLITS = parseAbi([
  "function commitSplit(address[] payees_, uint32[] weights_, uint32 feeBps_)",
  "function release()",
  "function withdraw()",
  "function committed() view returns (bool)",
  "function totalReleased() view returns (uint256)",
  "function pendingBalance(address account) view returns (uint256)",
  "function feeBps() view returns (uint32)",
  "event Released(address indexed token, address indexed to, uint256 amount)",
]);

async function send(label, txArgs) {
  const hash = await wallet.writeContract({ ...txArgs, account });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`${label} reverted (tx ${hash})`);
  console.log(`   ✅ ${label}`);
  console.log(`      ${EXPLORER}/tx/${hash}   (gas ${Number(receipt.gasUsed)}, block ${Number(receipt.blockNumber)})`);
  return { hash, receipt };
}

async function main() {
  console.log("\n💰 Real seal → sale → split payout — Robinhood Chain Testnet");
  console.log("=".repeat(66));
  console.log(`Producer: ${account.address}`);
  console.log(`Work:     ${workId}`);
  console.log(`Price:    ${PRICE} USDG per copy (${FEE_MODE})\n`);

  // --- 0. the exact payee table, from the app's own split math -------------
  const res = await fetch(`${APP_URL}/api/works/${workId}/split`);
  if (!res.ok) die(`GET /api/works/${workId}/split → ${res.status}`);
  const table = await res.json();
  if (!table.splitsContract) die("No Splits contract configured (NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS).");
  console.log("0) Split table (server-computed, weights out of 10_000)");
  table.payees.forEach((p, i) => {
    const row = table.breakdown?.find((b) => b.address.toLowerCase() === p.toLowerCase());
    console.log(`   ${p}  weight=${table.weights[i]}  (${row ? row.percentOfWork + "% of work" : "fee"})`);
  });
  console.log(`   feeBps=${table.feeBps}  total=${table.totalWeight}\n`);
  if (table.totalWeight !== 10000) die(`weights sum to ${table.totalWeight}, must be 10000`);

  const splits = table.splitsContract;
  const committed = await pub.readContract({ address: splits, abi: SPLITS, functionName: "committed" });

  // --- 1. mint the work release NFT ---------------------------------------
  console.log("1) Minting the work release NFT");
  const mint = await send("work NFT minted (producer, 5% resale royalty)", {
    address: NFT,
    abi: NFT_ABI,
    functionName: "mint",
    args: [account.address, `${APP_URL}/api/metadata/work/${workId}`, account.address, 500n],
  });
  let workTokenId = null;
  for (const l of mint.receipt.logs) {
    try {
      const d = decodeEventLog({ abi: NFT_ABI, data: l.data, topics: l.topics });
      if (d.eventName === "AssetMinted") workTokenId = String(d.args.tokenId);
    } catch {}
  }
  console.log(`      work token id: ${workTokenId}`);

  // --- 2. commit the split table (irreversible, once per contract) --------
  console.log("2) Committing the USDG split table on-chain");
  let commitTx;
  if (committed) {
    console.log("   ⏭  already committed — the table is immutable");
  } else {
    const done = await send(`commitSplit(${table.payees.length} payees, feeBps=${table.feeBps})`, {
      address: splits,
      abi: SPLITS,
      functionName: "commitSplit",
      args: [table.payees, table.weights, table.feeBps],
    });
    commitTx = done.hash;
  }

  // --- 3. buy a copy: USDG → the splits contract --------------------------
  console.log("3) Buying one copy (producer pays USDG into the split)");
  const price = BigInt(Math.round(PRICE * 1e6));
  const bal = await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (bal < price) die(`Producer holds ${formatUnits(bal, 6)} USDG, needs ${formatUnits(price, 6)}.`);
  const buy = await send(`transfer ${PRICE} USDG → splits contract`, {
    address: USDG,
    abi: ERC20,
    functionName: "transfer",
    args: [splits, price],
  });

  // --- 4. release: credit every payee pro-rata (permissionless) -----------
  console.log("4) Releasing the split (anyone can call this)");
  const rel = await send("release() — every payee credited pro-rata", {
    address: splits,
    abi: SPLITS,
    functionName: "release",
  });
  let credited = 0n;
  for (const l of rel.receipt.logs) {
    try {
      const d = decodeEventLog({ abi: SPLITS, data: l.data, topics: l.topics });
      if (d.eventName === "Released") {
        credited += d.args.amount;
        console.log(`      credited ${formatUnits(d.args.amount, 6)} USDG → ${d.args.to}`);
      }
    } catch {}
  }

  // --- 5. the producer withdraws their own share --------------------------
  console.log("5) Producer withdrawing their own share");
  const mine = await pub.readContract({ address: splits, abi: SPLITS, functionName: "pendingBalance", args: [account.address] });
  if (mine > 0n) {
    await send(`withdraw ${formatUnits(mine, 6)} USDG`, { address: splits, abi: SPLITS, functionName: "withdraw" });
  } else {
    console.log("   ⏭  nothing pending");
  }

  // --- 6. record the sale in the app --------------------------------------
  console.log("6) Recording the seal + sale in the app");
  try {
    const coverRes = await fetch(`${APP_URL}/api/upload`, {
      method: "POST",
      body: (() => {
        const fd = new FormData();
        fd.append("file", new Blob([readFileSync(COVER)], { type: "image/png" }), "cover.png");
        return fd;
      })(),
    });
    const cover = await coverRes.json();
    await fetch(`${APP_URL}/api/works/${workId}/seal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        basePriceEth: PRICE,
        feeMode: FEE_MODE,
        imagePath: cover.path ?? "cover.png",
        wallet: account.address,
        txHash: mint.hash,
        splitsTxHash: commitTx,
      }),
    });
    const sres = await fetch(`${APP_URL}/api/sales/buy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId, quantity: 1, txHash: buy.hash }),
    });
    const sjson = await sres.json().catch(() => ({}));
    console.log(`   sale recorded: ${sres.ok ? "yes" : "no — " + (sjson.error ?? sres.status)}`);
  } catch (e) {
    console.log(`   ⚠️  app API unreachable (${e.message}) — chain state is still correct`);
  }

  // --- 7. read back -------------------------------------------------------
  console.log("\n" + "=".repeat(66));
  console.log("✅ READ BACK FROM THE CHAIN");
  console.log(`   splits.committed   : ${await pub.readContract({ address: splits, abi: SPLITS, functionName: "committed" })}`);
  console.log(`   splits.feeBps      : ${await pub.readContract({ address: splits, abi: SPLITS, functionName: "feeBps" })}`);
  console.log(`   totalReleased      : ${formatUnits(await pub.readContract({ address: splits, abi: SPLITS, functionName: "totalReleased" }), 6)} USDG`);
  console.log(`   split contract bal : ${formatUnits(await pub.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [splits] }), 6)} USDG (0 = fully distributed)`);
  for (const p of table.payees) {
    const pending = await pub.readContract({ address: splits, abi: SPLITS, functionName: "pendingBalance", args: [p] });
    console.log(`   claimable ${p}: ${formatUnits(pending, 6)} USDG`);
  }
  console.log("");
}

main().catch((e) => die(e.message ?? String(e)));
