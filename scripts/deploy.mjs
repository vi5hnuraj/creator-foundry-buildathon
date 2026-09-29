#!/usr/bin/env node
/**
 * ONE-COMMAND DEPLOYMENT — Creator Foundry (Arbitrum Open House Buildathon)
 *
 * Deploys to Arbitrum Sepolia (chain 421614) using the ORIGINAL Paxos USDG
 * (no mocks):
 *   1. CreatorFoundryAssetNFT         → ERC-721 + ERC-2981 proof-of-authorship
 *   2. CreatorFoundrySplits           → USDG revenue-split distributor
 *      (constructor arg: token = real USDG testnet contract)
 *   3. CreatorFoundryBountyEscrow     → locks bounty rewards before work starts
 *      (constructor arg: token = real USDG testnet contract)
 * and writes all addresses into .env.local automatically.
 *
 * GETTING TEST USDG (real Paxos USDG, from Paxos docs):
 *   1. Create a free Paxos Developer (Sandbox) account
 *   2. Sandbox Dashboard → Deposit → asset: USDG, network: Arbitrum One (Sepolia)
 *      — or use the Paxos Testnet Faucet
 *   3. Copy YOUR deposit address, then request USDG from the faucet/dashboard Fund
 *   4. Withdraw on-chain from the Sandbox to your wallet 0x79e41c5ba4fd8b6fdf3e23c41f8429e71981ab3b
 *      (Sandbox USDG withdrawal limit: 1,000,000 per tx — plenty)
 *   Docs: https://docs.paxos.com/guides/developer/sandbox
 *         https://docs.paxos.com/guides/developer/fund-sandbox-with-test-crypto
 *
 * USAGE:
 *   1. Create a BURNER wallet (new MetaMask account — never your main one)
 *   2. Fund it with Arbitrum Sepolia ETH (see docs/DEPLOYMENT.md faucets) + test USDG (above)
 *   3. echo 'DEPLOYER_PRIVATE_KEY=0xyourkey' > .env.local
 *   4. npm run deploy robinhood-testnet
 *
 * SAFE TO RE-RUN: any contract whose address is already recorded for this chain
 * is left alone, so adding a new contract later cannot orphan the works, NFTs
 * and split tables that point at the existing deployments. Pass --force to
 * deliberately redeploy everything (that DOES invalidate existing records).
 *
 * WHERE ADDRESSES LIVE: deployments.json, keyed by chain. That file is the
 * source of truth (the app reads it via src/lib/chains.ts). Deploying a chain
 * ONLY rewrites .env.local when that chain is the currently active one
 * (NEXT_PUBLIC_CHAIN) — previously a second deploy silently repointed the app
 * at contracts that don't exist on the chain it was talking to. Override with
 * --write-env if you really want the env repointed.
 *
 * SAFETY: the key stays in .env.local (gitignored). It is sent ONLY to the
 * Arbitrum Sepolia RPC. Use a burner with testnet funds only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import solc from "solc";
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const REGISTRY_PATH = resolve(ROOT, "contracts/deployments.json");

dotenv.config({ path: resolve(ROOT, ".env.local") });

// Chain selection: node scripts/deploy.mjs [arbitrum-sepolia|robinhood-testnet]
const CHAINS = {
  "arbitrum-sepolia": {
    key: "arbitrum-sepolia",
    label: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    chainId: 421614,
    explorer: "https://sepolia.arbiscan.io",
    usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892", // real Paxos USDG
  },
  "robinhood-testnet": {
    key: "robinhood-testnet",
    label: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    chainId: 46630,
    explorer: "https://explorer.testnet.chain.robinhood.com",
    usdg: "0x7E955252E15c84f5768B83c41a71F9eba181802F", // real Paxos USDG
  },
};
const chainKey = process.argv[2] && CHAINS[process.argv[2]] ? process.argv[2] : "arbitrum-sepolia";
const CH = CHAINS[chainKey];

const RPC = CH.rpc;
const CHAIN_ID = CH.chainId;
const EXPLORER = CH.explorer;

/** REAL Paxos USDG (Global Dollar) testnet contract — from docs.paxos.com. */
const USDG_TESTNET = CH.usdg;
const CHAIN = {
  id: CHAIN_ID,
  name: CH.label,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: CH.label, url: EXPLORER } },
};

const FEE_WALLET = process.env.FORGE_FEE_WALLET; // optional override

function log(msg) { console.log(msg); }
function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }

// ---------------------------------------------------------------------------
// 0. Preflight
// ---------------------------------------------------------------------------
const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
  die(
    "DEPLOYER_PRIVATE_KEY not set.\n" +
    "  1. Create a BURNER MetaMask account (testnet only!)\n" +
    "  2. Fund it with Arbitrum Sepolia ETH (faucets in docs/DEPLOYMENT.md)\n" +
    "  3. Add to .env.local:  DEPLOYER_PRIVATE_KEY=0x...\n" +
    "  4. Run: npm run deploy"
  );
}
const account = privateKeyToAccount(pk);
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { chainOrder: [], chains: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (e) {
    die(`deployments.json is not valid JSON: ${e.message}`);
  }
}

const registry = loadRegistry();
registry.chains = registry.chains ?? {};
if (!Array.isArray(registry.chainOrder)) registry.chainOrder = [];
/** This chain's recorded contracts (may be empty on a first deploy). */
const recorded = registry.chains[chainKey] ?? {};
/** The chain the APP is currently pointed at, from .env.local. */
const activeChainKey = process.env.NEXT_PUBLIC_CHAIN || chainKey;
const writeEnv = process.argv.includes("--write-env") || activeChainKey === chainKey;

async function main() {
  log(`\n🚀 Creator Foundry — ${CH.label} deployment\n` + "=".repeat(60));
  log(`Deployer: ${account.address}`);
  log(`App's active chain (.env.local): ${activeChainKey}` + (writeEnv ? "" : "  → .env.local will NOT be repointed"));

  const balance = await publicClient.getBalance({ address: account.address });
  log(`Balance:  ${formatEther(balance)} ETH`);
  if (balance < parseEther("0.002")) {
    const faucets = chainKey === "robinhood-testnet"
      ? "  https://faucet.testnet.chain.robinhood.com/"
      : "  https://arbitrum.faucet.dev/  ·  https://faucet.quicknode.com/arbitrum/sepolia";
    die("Balance too low. Fund this address with test ETH:\n" + faucets);
  }
  if (balance < parseEther("0.05")) {
    log("⚠️  Balance is low — deployment needs ~0.01–0.03 ETH total. Continuing…");
  }

  // ---------------------------------------------------------------------
  // 1. Compile contracts with solc-js
  // ---------------------------------------------------------------------
  log("\n📦 Compiling contracts (solc 0.8.26)…");
  const sources = {
    "CreatorFoundryAssetNFT.sol": readFileSync(resolve(ROOT, "contracts/src/CreatorFoundryAssetNFT.sol"), "utf8"),
    "CreatorFoundrySplits.sol": readFileSync(resolve(ROOT, "contracts/src/CreatorFoundrySplits.sol"), "utf8"),
    "CreatorFoundryBountyEscrow.sol": readFileSync(resolve(ROOT, "contracts/src/CreatorFoundryBountyEscrow.sol"), "utf8"),
  };

  const nodeModules = resolve(ROOT, "node_modules");
  const remappings = {
    "@openzeppelin/": `${nodeModules}/@openzeppelin/`,
  };

  const importCallback = {
    import: (path) => {
      const remapped = remappings["@openzeppelin/"] + path.slice("@openzeppelin/".length);
      for (const candidate of [path, remapped]) {
        try {
          return { contents: readFileSync(candidate, "utf8"), error: undefined };
        } catch {
          /* try next */
        }
      }
      return { error: `File not found: ${path}` };
    },
  };

  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(sources).map(([file, content]) => [file, { content }])
    ),
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  function compileAll() {
    const output = JSON.parse(solc.compile(JSON.stringify(input), importCallback));
    if (output.errors) {
      const errors = output.errors.filter((e) => e.severity === "error");
      if (errors.length) {
        log(errors.map((e) => e.formattedMessage).join("\n"));
        die("Compilation failed.");
      }
      const warnings = output.errors.filter((e) => e.severity === "warning");
      for (const w of warnings) log(`  ⚠️  ${w.formattedMessage.trim().split("\n")[0]}`);
    }
    return output.contracts;
  }

  const compiled = compileAll();
  log("✅ Compiled contracts\n");

  // ---------------------------------------------------------------------
  // 2. Deploy helper
  // ---------------------------------------------------------------------
  async function deploy(file, contractName, args = [], label) {
    const artifact = compiled[file][contractName];
    const abi = artifact.abi;
    const bytecode = `0x${artifact.evm.bytecode.object}`;

    // viem's deployContract handles constructor encoding + nonce + gas.
    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args,
      account,
    });
    log(`⏳ Deploying ${label ?? contractName}… tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const address = receipt.contractAddress;
    log(`✅ ${label ?? contractName}: ${address}  (gas ${Number(receipt.gasUsed)}, block ${receipt.blockNumber})`);
    log(`   ${EXPLORER}/address/${address}\n`);
    return { address, abi };
  }

  // ---------------------------------------------------------------------
  // 3. Deploy in order (token = REAL Paxos USDG testnet contract)
  //
  // Skip anything already configured: re-running the script to add one new
  // contract must never silently replace an address that existing works,
  // minted NFTs and committed split tables already reference.
  // ---------------------------------------------------------------------
  const FORCE = process.argv.includes("--force");

  function usable(v) {
    if (!v || typeof v !== "string" || v.includes("0x<")) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v) || /^0x0+$/.test(v)) return null;
    return v;
  }

  /**
   * The address already recorded for THIS chain: the registry first (it's
   * per-chain and is what the app reads), then the flat env var as a fallback
   * for pre-registry deployments.
   */
  function existing(regKey, envKey) {
    return usable(recorded[regKey]) ?? usable(process.env[envKey] ?? process.env[regKey]);
  }

  /** Deploy only when unconfigured, else keep the recorded address. */
  async function deployOrKeep(regKey, envKey, file, contractName, args, label) {
    const already = existing(regKey, envKey);
    if (already && !FORCE) {
      // A recorded address that has no code on this chain is worse than none:
      // it makes the app build explorer links to nothing.
      const code = await publicClient.getBytecode({ address: already });
      if (!code || code === "0x") {
        log(`⚠️  ${label ?? contractName}: recorded at ${already} but there is NO CODE there — redeploying.`);
      } else {
        log(`⏭  ${label ?? contractName}: already deployed at ${already} (${(code.length - 2) / 2} bytes) — keeping it (--force to redeploy)`);
        recorded[regKey] = already;
        return { address: already, abi: compiled[file][contractName].abi, reused: true };
      }
    }
    const deployed = await deploy(file, contractName, args, label);
    recorded[regKey] = deployed.address;
    return { ...deployed, reused: false };
  }

  const nft = await deployOrKeep(
    "nft",
    "NEXT_PUBLIC_NFT_CONTRACT_ADDRESS",
    "CreatorFoundryAssetNFT.sol",
    "CreatorFoundryAssetNFT",
    [],
    "AssetNFT (ERC-721 + ERC-2981)"
  );

  const feeWallet = FEE_WALLET || account.address;
  const splits = await deployOrKeep(
    "splits",
    "NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS",
    "CreatorFoundrySplits.sol",
    "CreatorFoundrySplits",
    [account.address, feeWallet, USDG_TESTNET],
    `Splits (controller=deployer, feeWallet=${FEE_WALLET ? "env" : "deployer"}, token=real USDG)`
  );

  const escrow = await deployOrKeep(
    "escrow",
    "NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS",
    "CreatorFoundryBountyEscrow.sol",
    "CreatorFoundryBountyEscrow",
    [USDG_TESTNET],
    "BountyEscrow (locks bounty rewards; token=real USDG)"
  );

  // ---------------------------------------------------------------------
  // 4. Check your real USDG balance
  // ---------------------------------------------------------------------
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ];
  const usdgBal = await publicClient.readContract({
    address: USDG_TESTNET,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  log(`💵 USDG balance of ${account.address}: ${Number(usdgBal) / 1e6} USDG`);
  if (usdgBal === 0n) {
    log("⚠️  No test USDG yet. Get REAL Paxos USDG:");
    log("    1. Sign up at the Paxos Sandbox (docs.paxos.com/guides/developer/sandbox)");
    log("    2. Dashboard → Deposit → USDG on Arbitrum One (Sepolia) → copy deposit address");
    log("    3. Fund via the Paxos Testnet Faucet / Dashboard Fund button");
    log("    4. Withdraw on-chain from Sandbox to your wallet (limit 1,000,000/tx)");
    log("    Then restart the app — the splits contract already points at real USDG.\n");
  }

  // ---------------------------------------------------------------------
  // 5a. Write the per-chain registry — the app's source of truth
  // ---------------------------------------------------------------------
  registry.chains[chainKey] = {
    ...recorded,
    label: CH.label,
    chainId: CHAIN_ID,
    rpc: RPC,
    explorer: EXPLORER,
    usdg: USDG_TESTNET,
    nft: nft.address,
    splits: splits.address,
    escrow: escrow.address,
    primary: registry.chains[chainKey]?.primary ?? chainKey === activeChainKey,
  };
  if (!registry.chainOrder.includes(chainKey)) registry.chainOrder.push(chainKey);
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  log(`\n📇 Recorded ${CH.label} in deployments.json:`);
  log(`   nft=${nft.address}`);
  log(`   splits=${splits.address}`);
  log(`   escrow=${escrow.address}`);

  // ---------------------------------------------------------------------
  // 5b. Write .env.local — ONLY for the chain the app is already pointed at.
  //     Repointing it here is what previously made a second deploy overwrite
  //     the first chain's addresses and break the running app.
  // ---------------------------------------------------------------------
  const envPath = resolve(ROOT, ".env.local");
  if (!writeEnv) {
    log(`\n⏭  .env.local left alone (app is on "${activeChainKey}", this deploy is "${chainKey}").`);
    log(`   The app resolves addresses per chain from deployments.json, so nothing to do.`);
    log(`   Pass --write-env to repoint the app at ${CH.label} anyway.`);
  } else {
  let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const setEnv = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(env)) env = env.replace(re, `${key}=${value}`);
    else env += (env && !env.endsWith("\n") ? "\n" : "") + `${key}=${value}\n`;
  };

  setEnv("NEXT_PUBLIC_CHAIN", chainKey);
  setEnv("NEXT_PUBLIC_USDG_ADDRESS", USDG_TESTNET);
  setEnv("NEXT_PUBLIC_NFT_CONTRACT_ADDRESS", nft.address);
  setEnv("NEXT_PUBLIC_SPLITS_CONTRACT_ADDRESS", splits.address);
  setEnv("NEXT_PUBLIC_BOUNTY_ESCROW_ADDRESS", escrow.address);
  if (!env.includes("FORGE_FEE_WALLET=")) setEnv("FORGE_FEE_WALLET", feeWallet);
  // Preserve DEPLOYER_PRIVATE_KEY (it's already in the file).

  writeFileSync(envPath, env);

  // Redact EVERYTHING that looks like a credential before echoing the file
  // back. This previously only hid DEPLOYER_PRIVATE_KEY, so a run that printed
  // the env dumped the AI provider key into the terminal (and from there into
  // logs / screen recordings / pasted output).
  const SECRET_RE = /(private|secret|key|token|password|passwd|seed|mnemonic)/i;
  const redact = (line) => {
    const eq = line.indexOf("=");
    if (eq <= 0) return line;
    const name = line.slice(0, eq);
    if (name.trimStart().startsWith("#")) return line;
    if (!SECRET_RE.test(name)) return line;
    const value = line.slice(eq + 1);
    return `${name}=${value ? "••••(hidden)" : ""}`;
  };

  log("📝 Wrote .env.local:\n" +
      env.split("\n").filter(Boolean).map(redact).map((l) => "   " + l).join("\n"));
  }

  // ---------------------------------------------------------------------
  // 6. Summary
  // ---------------------------------------------------------------------
  log("\n" + "=".repeat(60));
  log("🎉 DEPLOYMENT COMPLETE — paste these into your submission form:\n");
  log(`   Chain:            ${CH.label} (${CHAIN_ID})`);
  log(`   USDG (real):      ${USDG_TESTNET}`);
  log(`   AssetNFT:         ${nft.address}`);
  log(`   Splits:           ${splits.address}`);
  log(`   BountyEscrow:     ${escrow.address}`);
  log(`   Fee wallet:       ${feeWallet}`);
  log(`\n   Explorer:         ${EXPLORER}/address/${nft.address}`);
  log(`\n   Escrow explorer:  ${EXPLORER}/address/${escrow.address}`);

  // Multi-chain surface — a judge will ask "is this on the chain I care about?".
  log("\n   Deployment registry (deployments.json):");
  for (const key of registry.chainOrder) {
    const c = registry.chains[key];
    if (!c) continue;
    const set = [c.nft && "NFT", c.splits && "Splits", c.escrow && "Escrow"].filter(Boolean);
    log(`     ${c.label.padEnd(26)} ${set.join(" · ")}${c.escrow ? "" : "   (escrow not deployed)"}`);
  }
  log("\nNext: npm run dev  →  run the demo flow (two MetaMask accounts).");
  log("See docs/DEPLOYMENT.md for the full demo script.\n");
}

main().catch((e) => die(e.message ?? String(e)));
