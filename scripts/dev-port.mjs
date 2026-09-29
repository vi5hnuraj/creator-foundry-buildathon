/**
 * Dev launcher — detects a free port (preferring 3000, then 3100+) and starts
 * `next dev` with NEXT_DEV_PORT set so next.config.js gives this instance its
 * own build dir (.next-dev-<port>). Multiple dev servers can now run at once
 * without clobbering each other's chunks (ChunkLoadError fix).
 */
import { createServer } from "node:net";
import { spawn } from "node:child_process";

const isFree = (port) =>
  new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });

async function pickPort() {
  const args = process.argv.slice(2);
  const dashP = args.indexOf("-p");
  if (dashP !== -1 && args[dashP + 1]) return Number(args[dashP + 1]); // explicit wins
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) return envPort;
  if (await isFree(3000)) return 3000;
  for (let p = 3100; p <= 3199; p += 10) {
    if (await isFree(p)) return p;
  }
  return 3200; // last resort
}

const port = await pickPort();
console.log(`\n  ▲ Creator Foundry dev server → http://localhost:${port}  (build dir: .next-dev-${port})\n`);

const child = spawn("npx", ["next", "dev", "-p", String(port)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_DEV_PORT: String(port), NEXT_DIST_DIR: `.next-dev-${port}` },
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
