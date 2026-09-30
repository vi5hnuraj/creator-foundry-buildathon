"use client";

import Link from "next/link";
import { useIdentity } from "@/lib/use-identity";
import { ConnectWallet } from "@/components/connect-wallet";
import { CHAIN_INFO } from "@/lib/nft-contract";

/**
 * Landing — dark editorial (Arbora-style canvas × tap-pay structure).
 * Amber testnet banner → mono eyebrow → giant serif headline → sans lead
 * with bold USDG → white pill + ghost CTA → big serif stats → numbered
 * moves → marquee → USDG + trust sections → final CTA.
 */

const MOVES = [
  {
    n: "01",
    glyph: "$",
    title: "Describe the work",
    body: "The producer types one sentence — a game, a film, an album. The AI director returns a full production plan: bounties with roles, USDG rewards, deliverable specs, and an inspiration board.",
  },
  {
    n: "02",
    glyph: "✦",
    title: "Claim and create",
    body: "Contributors claim bounties from the board and deliver assets. The AI critic scores every submission 0–100 against the style guide, palette, and quality bar before a human reviews.",
  },
  {
    n: "03",
    glyph: "OK",
    title: "Approve, then paid",
    body: "On approval the contributor is minted as the on-chain author (ERC-721 + ERC-2981) and paid the bounty in Paxos USDG — a wallet-signed stablecoin transfer, visible to anyone.",
  },
  {
    n: "04",
    glyph: "⚡",
    title: "Ship. Splits fire forever.",
    body: "Sealing commits the revenue split to a smart contract — immutable. Every future copy sale pays all contributors pro-rata in USDG. Anyone can trigger the release. The fee is 3%, on the record.",
  },
];

const MARQUEE =
  "AI PRODUCTION DIRECTOR + USDG SETTLEMENT + ERC-2981 AUTHORSHIP + IMMUTABLE SPLITS + PERMISSIONLESS PAYOUTS + 3% FEE + ";

export default function OnboardingPage() {
  const { isConnected } = useIdentity();

  return (
    <div className="-mx-6 md:-mx-8 -mt-8 px-6 md:px-8 pb-24">
      {/* ============ TESTNET BANNER (full-bleed) ============ */}
      <div className="-mx-6 md:-mx-8 border-b border-[color:var(--amber)]/20 bg-[color:var(--amber)]/[0.07] px-6 py-3 text-center md:px-8">          <p className="rf-data text-[11px] uppercase tracking-[0.18em] text-[color:var(--amber)]">
            ● Testnet demo — smart contracts are unaudited · built for the
            Robinhood Chain + Arbitrum wallets · do not send real funds
          </p>
      </div>

      {/* ============ HERO ============ */}
      <section className="mx-auto max-w-6xl pt-16 md:pt-20">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          <span className="text-[color:var(--green)]">●</span> Live on{" "}
          {CHAIN_INFO.name} · Royalties in USDG · Splits enforced on-chain
        </p>

        <h1 className="rf-display mt-8 max-w-4xl text-[clamp(2.9rem,8vw,6rem)] leading-[1.02] tracking-[-0.02em] text-t1">
          Credit where credit
          <br />
          is paid.
        </h1>

        <p className="mt-10 max-w-2xl text-lg leading-relaxed text-t3 md:text-xl">
          Creator Foundry is a production desk for creative teams. AI plans the
          work and reviews every submission with a 0–100 score; when the work
          ships, a smart contract pays every contributor their exact share in{" "}
          <strong className="text-t1">USDG</strong> on Robinhood Chain — at
          every sale, forever.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          {!isConnected ? (
            <>
              <ConnectWallet size="lg" />
              <a href="#how" className="btn-ghost px-6 py-2.5 text-base">
                See how it works
              </a>
            </>
          ) : (
            <>
              <Link href="/works" className="btn-primary px-6 py-2.5 text-base">
                Open the producer desk
              </Link>
              <Link href="/artist" className="btn-ghost px-6 py-2.5 text-base">
                Open the contributor hub
              </Link>
            </>
          )}
        </div>

        {/* ============ BIG SERIF STATS ============ */}
        <div className="mt-24 grid gap-12 border-t border-[color:var(--border-subtle)] pt-14 sm:grid-cols-2 lg:grid-cols-4">
          <Stat value="3%" label="platform fee — on the record, in the contract" tone="text-[color:var(--salmon)]" />
          <Stat value="100%" label="of every sale split pro-rata in USDG" tone="text-t1" />
          <Stat value="0–100" label="critic score on every submission" tone="text-t1" />
          <Stat value="2" label="chains: Arbitrum Sepolia + Robinhood testnet" tone="text-t1" />
        </div>
      </section>

      {/* ============ MARQUEE ============ */}
      <div className="mt-24 overflow-hidden border-y border-[color:var(--border-subtle)] py-3">
        <div className="rf-data animate-[marquee_32s_linear_infinite] whitespace-nowrap text-xs uppercase tracking-[0.2em] text-t3">
          {MARQUEE + MARQUEE}
        </div>
      </div>

      {/* ============ HOW IT WORKS ============ */}
      <section id="how" className="mx-auto mt-28 max-w-6xl scroll-mt-20">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          Four moves
        </p>
        <h2 className="rf-display mt-4 max-w-2xl text-4xl leading-[1.05] text-t1 md:text-6xl">
          From idea to paid.
          <br />
          Nothing in between.
        </h2>

        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] md:grid-cols-2">
          {MOVES.map((m) => (
            <div key={m.n} className="bg-[color:var(--surface)] p-8 md:p-10">
              <div className="flex items-baseline justify-between">
                <span className="rf-display text-4xl text-t1">{m.glyph}</span>
                <span className="rf-data text-xs text-t4">{m.n}</span>
              </div>
              <h3 className="rf-display mt-8 text-2xl text-t1">{m.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-t3">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ============ USDG ============ */}
      <section className="mx-auto mt-32 max-w-6xl">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          Exact payout, settled in USDG
        </p>
        <h2 className="rf-display mt-4 max-w-3xl text-4xl leading-[1.05] text-t1 md:text-6xl">
          Priced once.
          <br />
          Paid exactly.
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-t3">
          Bounties and royalties are denominated in{" "}
          <strong className="text-t1">Paxos USDG</strong> — the regulated Global
          Dollar. Contributors know exactly what they'll receive: no token
          volatility between agreeing and getting paid.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          <Spec label="Stable" value="1 USDG = $1" sub="Paxos-issued, regulated" />
          <Spec label="On-chain" value="Arbitrum" sub="+ Robinhood testnet" />
          <Spec label="Fee" value="3%" sub="vs. 30% industry standard" />
        </div>
      </section>

      {/* ============ TRUST ============ */}
      <section className="mx-auto mt-32 max-w-6xl">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          Trust the record
        </p>
        <h2 className="rf-display mt-4 max-w-2xl text-4xl leading-[1.05] text-t1 md:text-6xl">
          Know the author.
          <br />
          Before the money moves.
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-t3">
          Attribution isn't a name field in a database. Every approved
          contribution is minted as an NFT with the creator as the permanent
          royalty receiver — verifiable on the explorer in seconds.
        </p>

        <div className="mt-10 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-raised)] p-8 md:p-10">
          <div className="flex items-center justify-between">
            <p className="rf-data text-[11px] uppercase tracking-[0.2em] text-t3">
              Authorship check · live
            </p>
            <span className="rf-data text-[11px] uppercase tracking-widest text-[color:var(--green)]">
              ● Verified
            </span>
          </div>
          <div className="mt-6 divide-y divide-[color:var(--border-subtle)]">
            <Check text="Creator is the ERC-2981 royalty receiver" />
            <Check text="Contribution minted on-chain at approval" />
            <Check text="Revenue split committed immutable at seal" />
            <Check text="Anyone can trigger the payout release" />
          </div>
          <a
            className="rf-data mt-6 inline-block text-[11px] uppercase tracking-widest text-t3 underline decoration-dotted underline-offset-4 hover:text-t1"
            href={CHAIN_INFO.explorer}
            target="_blank"
            rel="noreferrer"
          >
            Read the contracts on the explorer ↗
          </a>
        </div>
      </section>

      {/* ============ PROTOCOL ============ */}
      <section className="mx-auto mt-32 max-w-6xl">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          Built as a protocol
        </p>
        <h2 className="rf-display mt-4 max-w-2xl text-4xl leading-[1.05] text-t1 md:text-6xl">
          Rails for the next studio.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] md:grid-cols-2">
          <Panel title="CreatorFoundryAssetNFT" body="ERC-721 + ERC-2981 — proof-of-authorship with per-token royalties to the contributor." />
          <Panel title="CreatorFoundrySplits" body="Immutable USDG split tables with permissionless release and pull-based withdrawals." />
          <Panel title="Foundry Intelligence" body="Multi-agent orchestrator: planner, critic, memory, royalty intelligence, publishing." />
          <Panel title="Wallet-first identity" body="No accounts. Your wallet is your studio pass on Arbitrum." />
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="mx-auto mt-36 max-w-6xl">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          Your next credit
        </p>
        <h2 className="rf-display mt-4 text-5xl leading-[1.02] text-t1 md:text-7xl">
          Make it on the record.
        </h2>
        <div className="mt-10 flex flex-wrap gap-4">
          {!isConnected ? (
            <ConnectWallet size="lg" />
          ) : (
            <>
              <Link href="/works" className="btn-primary px-6 py-2.5 text-base">
                Produce a work
              </Link>
              <Link href="/artist" className="btn-ghost px-6 py-2.5 text-base">
                Contribute work
              </Link>
            </>
          )}
        </div>

        <div className="mt-24 border-t border-[color:var(--border-subtle)] pt-6">
          <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
            <span className="rf-display text-xl text-t1">Creator Foundry</span>
            <p className="rf-data text-[11px] text-t4">
              ARBITRUM OPEN HOUSE SINGAPORE — BUILDATHON 2026 · SETTLED IN PAXOS
              USDG
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div>
      <p className={`rf-display text-6xl md:text-7xl ${tone}`}>{value}</p>
      <p className="mt-3 max-w-[230px] text-sm leading-relaxed text-t3">{label}</p>
    </div>
  );
}

function Spec({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-raised)] p-6">
      <p className="rf-data text-[11px] uppercase tracking-widest text-t3">{label}</p>
      <p className="rf-display mt-2 text-3xl text-t1">{value}</p>
      {sub && <p className="mt-1 text-xs text-t3">{sub}</p>}
    </div>
  );
}

function Check({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-t2">{text}</span>
      <span className="rf-data text-[11px] font-semibold uppercase tracking-widest text-[color:var(--green)]">
        Pass
      </span>
    </div>
  );
}

function Panel({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-[color:var(--surface)] p-8">
      <p className="rf-data text-sm font-semibold text-t1">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-t3">{body}</p>
    </div>
  );
}
