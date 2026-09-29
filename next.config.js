/** @type {import('next').NextConfig} */
// Every dev server instance gets its OWN build dir keyed by port
// (.next-dev-3000, .next-dev-3100, …) so multiple dev servers can run
// simultaneously without clobbering each other's chunks — the root cause of
// ChunkLoadError / "Loading chunk failed" when 3000 and 3100 ran together.
// Production builds (`npm run build`) always go to .next.
const isDev =
  process.env.npm_lifecycle_event === "dev" ||
  (process.env.NEXT_DIST_DIR || "").startsWith(".next-dev");

// Port-aware dev dist dir: NEXT_DEV_PORT is set by the `dev` script.
const devPort = process.env.NEXT_DEV_PORT || "3000";
const devDistDir = `.next-dev-${devPort}`;

const nextConfig = {
  reactStrictMode: true,
  distDir: isDev ? devDistDir : ".next",
  webpack: (config) => {
    // Optional deps pulled in by WalletConnect / MetaMask SDK that aren't needed
    // in the browser bundle. Externalizing them silences "Module not found" noise.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @react-native-async-storage is only used in React Native; stub it out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

module.exports = nextConfig;
