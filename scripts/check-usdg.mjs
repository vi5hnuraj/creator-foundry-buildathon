import { createPublicClient, http } from "viem";

const WALLET = "0x79E41C5ba4fd8B6Fdf3E23C41F8429E71981AB3B";
const CHAINS = [
  {
    name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    usdg: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
    explorer: "https://sepolia.arbiscan.io",
  },
  {
    name: "Robinhood Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    usdg: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
];

const abi = [
  { name: "balanceOf", outputs: [{ type: "uint256" }], inputs: [{ type: "address" }], stateMutability: "view", type: "function" },
];

for (const c of CHAINS) {
  const client = createPublicClient({ transport: http(c.rpc, { timeout: 20_000 }) });
  try {
    const usdg = await client.readContract({ address: c.usdg, abi, functionName: "balanceOf", args: [WALLET] });
    const eth = await client.getBalance({ address: WALLET });
    console.log(`${c.name}:  ${Number(usdg) / 1e6} USDG  ·  ${Number(eth) / 1e18} ETH`);
  } catch (e) {
    console.log(`${c.name}:  RPC error — ${String(e.message ?? e).slice(0, 80)}`);
  }
}
