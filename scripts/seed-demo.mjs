/**
 * Seed script — populates the local JSON fallback DB with realistic demo data
 * so the app (and a hackathon demo) never shows an empty state.
 *
 * Usage:  node scripts/seed-demo.mjs
 * Safe to re-run: wipes and re-seeds works/bounties/sales (keeps uploads).
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DB_FILE = resolve(ROOT, "data/local/.creator-foundry-db.json");

// Your producer wallet + a plausible demo contributor wallet.
const PRODUCER = "0x79E41C5ba4fd8B6Fdf3E23C41F8429E71981AB3B";
const CONTRIBUTOR = "0xA11ce0000000000000000000000000000000c0de";

const now = Date.now();
const daysAgo = (d, h = 0) => new Date(now - d * 86400_000 - h * 3600_000).toISOString();
const fakeHash = (seed) =>
  "0x" + (seed + "0".repeat(64)).slice(0, 64).split("").map((c, i) => "0123456789abcdef"[(seed.charCodeAt(i % seed.length) + i) % 16]).join("");

const db = existsSync(DB_FILE)
  ? JSON.parse(readFileSync(DB_FILE, "utf-8"))
  : { works: [], bounties: [], sales: [], storage: {} };

// ---- Work 1: fully produced & sealed (shows the whole lifecycle) ----------
const work1 = {
  id: "demo-pixel-odyssey",
  title: "Pixel Odyssey (retro platformer)",
  description:
    "A 16-bit side-scrolling platformer with hand-drawn pixel art and a synthwave soundtrack. Team of five; shipping the demo build to the store this week.",
  requester_addr: PRODUCER,
  asset_contract: "0xb176b9ea780c534c47c15a9651f7af1b80302b10",
  work_contract: "0x66ffff1d5bd5cd41e4cd9695875f1e8e96bdd845",
  status: "sealed",
  base_price_eth: 12,
  fee_mode: "absorb",
  seal_tx_hash: fakeHash("seal-pixel-odyssey"),
  created_at: daysAgo(6),
};

const work2 = {
  id: "demo-deep-signal",
  title: "Deep Signal (short film)",
  description:
    "A 12-minute sci-fi short about a deep-sea research crew that hears a structured signal from the trench. Currently in production — concept art done, score and VFX in flight.",
  requester_addr: PRODUCER,
  asset_contract: "0xb176b9ea780c534c47c15a9651f7af1b80302b10",
  work_contract: null,
  status: "open",
  base_price_eth: null,
  fee_mode: null,
  seal_tx_hash: null,
  created_at: daysAgo(2),
};

// ---- Bounties across every lifecycle state --------------------------------
const bounties = [
  // Work 1 — all minted (history) + sealed splits
  {
    id: "demo-bounty-pixel-hero",
    work_id: work1.id,
    title: "Hero sprite sheet (idle / run / jump)",
    role: "concept_artist",
    reward_eth: 120,
    revenue_percent: 8,
    instructions:
      "16-bit pixel art hero, 3 animation cycles at 32×32, palette aligned to the project's brand colors.",
    deliverable_specs: "PNG sprite sheet + preview GIF, transparent background",
    reference_path: null,
    status: "minted",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: "1",
    tx_hash: fakeHash("mint-hero-sprites"),
    created_at: daysAgo(6),
    updated_at: daysAgo(4),
  },
  {
    id: "demo-bounty-pixel-music",
    work_id: work1.id,
    title: "Synthwave overworld theme",
    role: "musician",
    reward_eth: 90,
    revenue_percent: 6,
    instructions:
      "Loopable 90-second chiptune + synthwave hybrid, 120 BPM, main menu / overworld vibe.",
    deliverable_specs: "WAV 44.1kHz loop + MP3 preview",
    reference_path: null,
    status: "minted",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: "2",
    tx_hash: fakeHash("mint-overworld-theme"),
    created_at: daysAgo(6),
    updated_at: daysAgo(3),
  },
  {
    id: "demo-bounty-pixel-level",
    work_id: work1.id,
    title: "Level design — first three stages",
    role: "game_designer",
    reward_eth: 150,
    revenue_percent: 10,
    instructions:
      "Tile-based level layouts introducing dash, wall-jump, and the first mini-boss.",
    deliverable_specs: "TMX/JSON level files + annotated screenshots",
    reference_path: null,
    status: "minted",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: "3",
    tx_hash: fakeHash("mint-level-design"),
    created_at: daysAgo(5),
    updated_at: daysAgo(2),
  },
  {
    id: "demo-bounty-pixel-boss",
    work_id: work1.id,
    title: "Mini-boss: The Clockwork Sentry",
    role: "animator",
    reward_eth: 80,
    revenue_percent: 4,
    instructions: "3-phase boss with idle, wind-up, attack, and defeat animations.",
    deliverable_specs: "Sprite sheet + 30s gameplay capture",
    reference_path: null,
    status: "minted",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: "4",
    tx_hash: fakeHash("mint-clockwork-sentry"),
    created_at: daysAgo(5),
    updated_at: daysAgo(1),
  },

  // Work 2 — open, claimed, delivered, and one awaiting revision
  {
    id: "demo-bounty-deep-concept",
    work_id: work2.id,
    title: "Concept art — trench station exteriors",
    role: "concept_artist",
    reward_eth: 200,
    revenue_percent: 12,
    instructions:
      "Bioluminescent research station at 4,000m. Moody blues/teals, practical lights, scale humans for drama.",
    deliverable_specs: "3 keyframes, 4K PNG + brief rationale",
    reference_path: null,
    status: "minted",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: "5",
    tx_hash: fakeHash("mint-trench-station"),
    created_at: daysAgo(2),
    updated_at: daysAgo(1),
  },
  {
    id: "demo-bounty-deep-score",
    work_id: work2.id,
    title: "Score sketch — the signal motif",
    role: "musician",
    reward_eth: 150,
    revenue_percent: 9,
    instructions:
      "8-bar motif built from a sonar ping transformed into strings; will loop under dialogue.",
    deliverable_specs: "STEMs + MIDI + 60s render",
    reference_path: null,
    status: "delivered",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: null,
    tx_hash: null,
    created_at: daysAgo(2, 4),
    updated_at: daysAgo(0, 5),
  },
  {
    id: "demo-bounty-deep-vfx",
    work_id: work2.id,
    title: "VFX shot — pressure hull breach",
    role: "animator",
    reward_eth: 250,
    revenue_percent: 15,
    instructions:
      "Simulated breach with water fill, glass shards, bubble particulate. Match the concept palette.",
    deliverable_specs: "EXR sequence + QuickTime preview",
    reference_path: null,
    status: "claimed",
    claimed_by: CONTRIBUTOR,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: null,
    tx_hash: null,
    created_at: daysAgo(1, 6),
    updated_at: daysAgo(0, 9),
  },
  {
    id: "demo-bounty-deep-script",
    work_id: work2.id,
    title: "Dialogue polish — scenes 4–6",
    role: "writer",
    reward_eth: 60,
    revenue_percent: 3,
    instructions: "Tighten the comms-room exchange; keep jargon but add subtext.",
    deliverable_specs: "Fountain/PDF revision with change notes",
    reference_path: null,
    status: "open",
    claimed_by: null,
    claimed_by_kind: "human",
    delivery_ipfs: null,
    delivery_path: null,
    revision_feedback: null,
    revision_ref_image: null,
    token_id: null,
    tx_hash: null,
    created_at: daysAgo(0, 8),
    updated_at: daysAgo(0, 8),
  },
];

// ---- Sales on the sealed work --------------------------------------------
const sales = [
  {
    id: "demo-sale-1",
    work_id: work1.id,
    source: "usdg_storefront",
    quantity: 3,
    amount_eth: 36,
    tx_hash: fakeHash("sale-storefront-1"),
    created_at: daysAgo(1, 2),
  },
  {
    id: "demo-sale-2",
    work_id: work1.id,
    source: "usdg_storefront",
    quantity: 1,
    amount_eth: 12,
    tx_hash: fakeHash("sale-storefront-2"),
    created_at: daysAgo(0, 3),
  },
];

db.works = [work2, work1]; // newest first
db.bounties = bounties;
db.sales = sales;

writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
console.log("🌱 Seeded demo data:");
console.log(`   works:    ${db.works.length}  (1 sealed + 1 open)`);
console.log(`   bounties: ${db.bounties.length}  (open/claimed/delivered/minted)`);
console.log(`   sales:    ${db.sales.length}`);
console.log(`   producer:    ${PRODUCER}`);
console.log(`   contributor: ${CONTRIBUTOR}`);
console.log("\nRestart the dev server (or just refresh) to see it.");
