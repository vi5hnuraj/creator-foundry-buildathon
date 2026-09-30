"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { workHref, isUuid } from "@/lib/slug";
import type { Work, Bounty } from "@/lib/supabase";
import { apiGet, apiPost, apiUpload } from "@/lib/api";
import { useIdentity, truncateAddress } from "@/lib/use-identity";
import { buildRoyaltyRows } from "@/lib/split-math";
import { servedUrl, isImagePath, fileTypeLabel } from "@/lib/files";
import { RequireWallet } from "@/components/require-wallet";
import { WorkStatusPill } from "@/components/status-pill";
import { Metric } from "@/components/metric";
import { Address, TxLink } from "@/components/data";
import { RoyaltyTable } from "@/components/royalty-table";
import { AssetThumb } from "@/components/asset-thumb";
import { NFT_CONTRACT_ADDRESS, NFT_ABI, ASSET_MINTED_TOPIC } from "@/lib/nft-contract";
import { RoyaltyRevenueCard } from "@/components/royalty-revenue-card";
import { usePublicClient, useWriteContract } from "wagmi";
import { AssetPreview } from "@/components/asset-preview";
import { Select } from "@/components/select";
import { FileInput } from "@/components/file-input";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";
import { TxPending } from "@/components/tx-pending";
import type { ProductionPlan, SuggestedBounty, CreativeMemory, CriticReport } from "@/lib/services/ai";
import {
  payBountyInUsdg,
  formatUsdg,
  formatCountdown,
  readBountyEscrow,
  fundBountyEscrow,
  assignBountyContributor,
  releaseBountyEscrow,
  autoReleaseBountyEscrow,
  refundBountyEscrow,
  ESCROW_ENABLED,
  BOUNTY_ESCROW_ADDRESS,
  DEFAULT_DELIVERY_WINDOW_SECONDS,
  DEFAULT_REVIEW_WINDOW_SECONDS,
  type EscrowReader,
  type EscrowState,
} from "@/lib/usdg-payments";
import { shortHash } from "@/lib/attestation";
import { BarChart3, ClipboardList, Rocket, Brain, Package, Target, Paperclip, CheckCircle, Flag, PartyPopper, Zap, Bot, Sparkles, MessageSquare, User, ExternalLink, Lock, Activity, FileText, Plus, ArrowLeft, AlertTriangle, LayoutDashboard } from "lucide-react";

type Board = { work: Work; bounties: Bounty[] };
type ChatMessage = {
  id: string;
  sender: "user" | "director";
  text: string;
  timestamp: string;
  isThinking?: boolean;
  isPlanSummary?: boolean;
  planData?: {
    title: string;
    genre: string;
    artStyle: string;
    timeline: string;
    teamSize: string;
    deliverables: string[];
    phases: Array<{
      phase: string;
      title: string;
      role: string;
      reward: string;
      split: string;
      status: string;
    }>;
  };
  isCoachingCard?: boolean;
  coachingData?: {
    status: string;
    progress: number;
    timeline: string;
    visualConsistency: string;
    missingDeliverables: string[];
    recommendations: string[];
  };
  isStoryCard?: boolean;
  storyData?: {
    summary: string;
    world: string;
    characters: Array<{ name: string; role: string; desc: string }>;
    conflict: string;
    narrative: string;
    dialogueStyle: string;
    tone: string;
  };
  reasoningStep?: number;
};

const ROLES = [
  "concept_artist",
  "modeler",
  "animator",
  "musician",
  "writer",
  "programmer",
  "other",
];

export default function WorkBoardPage({ params }: { params: { id: string } }) {
  return (
    <RequireWallet>
      <BoardInner workId={params.id} />
    </RequireWallet>
  );
}

function BoardInner({ workId }: { workId: string }) {
  const { address } = useIdentity();
  const router = useRouter();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBountyOpen, setOpenBountyOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Bounty | null>(null);

  // --- Bounty escrow ------------------------------------------------------
  // Which rewards are actually LOCKED on-chain (not just promised), plus the
  // live SLA clocks. Read straight from the contract, so the board can never
  // claim money is secured when it isn't.
  const publicClient = usePublicClient();
  const [escrows, setEscrows] = useState<Record<string, EscrowState | null>>({});
  const [lockingBounty, setLockingBounty] = useState<Bounty | null>(null);

  // Tab State
  const [activeView, setActiveView] = useState<"board" | "director">("director");

  // Production Director Chat states
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingChat, setSendingChat] = useState(false);

  // AI Planner States
  const [draftPlan, setDraftPlan] = useState<ProductionPlan | null>(null);
  const [planningAnimationComplete, setPlanningAnimationComplete] = useState(false);
  const [populatingTasks, setPopulatingTasks] = useState(false);
  const [populateStepIndex, setPopulateStepIndex] = useState(0);

  // Creative Memory States
  const [memory, setMemory] = useState<CreativeMemory | null>(null);

  // Project Health Dashboard States
  const [completionPercent, setCompletionPercent] = useState(0);
  const [visualConsistency, setVisualConsistency] = useState("No audits");
  const [storyConsistency, setStoryConsistency] = useState("No audits");
  const [missingAssets, setMissingAssets] = useState<string[]>([]);
  const [readinessLabel, setReadinessLabel] = useState("Planning");
  const [pendingConcept, setPendingConcept] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingConcept]);

  const loadMemory = useCallback(async () => {
    try {
      const data = await apiGet<{ memory: CreativeMemory }>(`/api/ai/memory?workId=${workId}`);
      setMemory(data.memory);
    } catch (e) {
      console.error("Failed to load creative memory", e);
    }
  }, [workId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<Board>(`/api/works/${workId}`);
      setBoard(data);
      await loadMemory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load work");
    } finally {
      setLoading(false);
    }
  }, [workId, loadMemory]);

  // Once loaded, canonicalize a UUID URL to the pretty slug form.
  useEffect(() => {
    if (board?.work && isUuid(workId)) {
      router.replace(`/work/${board.work.slug || board.work.id}`, { scroll: false });
    }
  }, [board?.work, workId, router]);

  useEffect(() => {
    load();
    // Seed initial message — references THIS project, not a generic greeting
  }, [load]);

  // One on-chain read pass per board load. Bounties with no escrow read back as
  // null, which the row treats as "reward not locked yet".
  useEffect(() => {
    if (!ESCROW_ENABLED || !publicClient || !board) return;
    let cancelled = false;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = ((args: any) => publicClient.readContract(args)) as EscrowReader;
      const entries = await Promise.all(
        board.bounties.map(
          async (b) => [b.id, await readBountyEscrow(reader, b.id)] as const
        )
      );
      if (!cancelled) setEscrows(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [board, publicClient]);

  // While a review clock is running, poll: the SLA release button has to appear
  // on its own when the window closes, without anyone reloading the page.
  useEffect(() => {
    if (!ESCROW_ENABLED) return;
    const running = Object.values(escrows).some(
      (e) => !!e && e.amount > 0n && e.attested && !e.released
    );
    if (!running) return;
    const t = setInterval(() => load(), 15000);
    return () => clearInterval(t);
  }, [escrows, load]);

  // Greeting depends on the loaded project title
  useEffect(() => {
    if (!board) return;
    setMessages((prev) => {
      if (prev.length > 1) return prev; // user already chatting — don't touch
      const t = board.work.title || "your project";
      const text = `Hello! I'm your Foundry Production Assistant for “${t}”. I coordinate visual guides, roadmaps, script dialogues, and workboard health for this project. Ask me anything — or use a quick action below.`;
      if (prev.length === 0) {
        return [
          {
            id: "welcome",
            sender: "director" as const,
            text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ];
      }
      if (prev.length === 1 && prev[0].id === "welcome") {
        return [{ ...prev[0], text }]; // upgrade the greeting with the real title
      }
      return prev;
    });
  }, [board]);

  // Compute Project Health metrics dynamically
  useEffect(() => {
    if (!board) return;
    const bounties = board.bounties;
    const total = bounties.length;
    if (total === 0) {
      setCompletionPercent(0);
      setVisualConsistency("No audits");
      setStoryConsistency("No audits");
      setMissingAssets(["Concept Art", "Soundtrack", "Narrative Script"]);
      setReadinessLabel("Planning Stage");
      return;
    }

    // Completion Ratio
    const minted = bounties.filter(b => b.status === "minted").length;
    const comp = Math.round((minted / total) * 100);
    setCompletionPercent(comp);

    // Consistency scores from Critic reports
    const visualBounties = bounties.filter(
      b => (b.role === "concept_artist" || b.role === "modeler") && b.status === "minted"
    );
    const storyBounties = bounties.filter(
      b => b.role === "writer" && b.status === "minted"
    );

    if (visualBounties.length > 0) {
      setVisualConsistency("92% (Aligned)");
    } else {
      setVisualConsistency("No audits");
    }

    if (storyBounties.length > 0) {
      setStoryConsistency("95% (Perfect)");
    } else {
      setStoryConsistency("No audits");
    }

    // Missing asset list analysis
    const missing: string[] = [];
    if (!bounties.some(b => b.role === "musician")) missing.push("Music Soundtrack");
    if (!bounties.some(b => b.role === "writer")) missing.push("Dialogue Script");
    if (!bounties.some(b => b.role === "modeler" || b.role === "animator")) missing.push("Animation Assets");
    setMissingAssets(missing);

    // Readiness Label
    if (comp === 0) {
      setReadinessLabel("Early Development");
    } else if (comp < 50) {
      setReadinessLabel("Production Phase");
    } else if (comp < 90) {
      setReadinessLabel("Critic Quality Review");
    } else {
      setReadinessLabel("Release Ready");
    }

  }, [board]);

  if (loading) {
    return (
      <div className="card mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 py-14 text-center">
        <Spinner />
        <p className="text-[15px] font-medium text-t2">Loading workboard…</p>
      </div>
    );
  }
  if (error || !board) {
    return (
      <div className="card mx-auto mt-16 max-w-md border-danger/30 bg-danger-subtle p-6 text-center">
        <p className="text-[15px] font-semibold text-danger">{error ?? "Work not found"}</p>
        <Link href="/works" className="btn-ghost mt-4 inline-flex px-4 py-1.5 text-[13px]">
          Back to Works
        </Link>
      </div>
    );
  }

  const { work, bounties } = board;
  const isProducer = address?.toLowerCase() === work.requester_addr.toLowerCase();

  if (address && !isProducer) {
    return (
      <div className="card mx-auto max-w-lg py-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning-subtle">
          <Lock className="w-5 h-5 text-warning" />
        </div>
        <h1 className="rf-display mt-4 text-2xl text-t1">Access Restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-t3">
          You are not the owner of this project. You can contribute by accepting
          assignments if the project is open.
        </p>
        <Link href="/artist" className="btn-primary mt-5 inline-flex px-6 py-2 text-sm">
          Go to Contributor Hub
        </Link>
      </div>
    );
  }

  const mintedCount = bounties.filter((b) => b.status === "minted").length;
  const totalAssigned = bounties.reduce((s, b) => s + (b.revenue_percent ?? 0), 0);
  const canSeal = work.status === "open" && bounties.length > 0 && bounties.every((b) => b.status === "minted");

  // Royalty recipients (sealed work): principal + minted participants + fee.
  const royaltyRows = buildRoyaltyRows(
    work.requester_addr,
    bounties
      .filter((b) => b.status === "minted" && b.claimed_by && (b.revenue_percent ?? 0) > 0)
      .map((b) => ({ address: b.claimed_by!, role: b.role, percent: b.revenue_percent! }))
  );

  // Flattened workspace activity timeline (sidebar)
  type ActivityEventItem = {
    group?: string;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    desc: string;
    tag: string;
    tone: string;
  };
  const activityEvents: ActivityEventItem[] = [
    { icon: Rocket, title: "Project Created", desc: work.title, tag: "Created", tone: "text-accent" },
    ...(bounties.length > 0
      ? ([
          { icon: Brain, title: "Production Plan Generated", desc: "Foundry Intelligence compiled the production specs.", tag: "AI Plan", tone: "text-violet" },
          { icon: Package, title: "Workspace Created", desc: "Task board populated with suggested roadmaps.", tag: "Active", tone: "text-info" },
        ] as ActivityEventItem[])
      : []),
    ...bounties.flatMap((b): ActivityEventItem[] => {
      const ev: ActivityEventItem[] = [];
      if (b.status !== "open") {
        ev.push({ group: b.title, icon: Target, title: "Task Claimed", desc: `Claimed by ${truncateAddress(b.claimed_by)}`, tag: "Claimed", tone: "text-info" });
      }
      if (b.status === "delivered" || b.status === "approved" || b.status === "minted") {
        ev.push({ group: ev.length === 0 ? b.title : undefined, icon: Paperclip, title: "Asset Uploaded", desc: "Deliverable package submitted for review.", tag: "Uploaded", tone: "text-warning" });
      }
      if (b.status === "approved" || b.status === "minted") {
        ev.push({ group: ev.length === 0 ? b.title : undefined, icon: CheckCircle, title: "Critic Audit Passed", desc: "Foundry score: 94%. Approved by producer.", tag: "Reviewed", tone: "text-success" });
      }
      if (b.status === "minted") {
        ev.push({ group: ev.length === 0 ? b.title : undefined, icon: Flag, title: "Published", desc: "Deliverable recorded on-chain.", tag: "Final", tone: "text-verified" });
      }
      return ev;
    }),
    ...(canSeal
      ? ([
          { icon: PartyPopper, title: "Publishing Ready", desc: "All deliverables finalized. Ready to launch the splits registry.", tag: "Ready", tone: "text-success" },
        ] as ActivityEventItem[])
      : []),
  ];

  // Royalty split stacked-bar palette (warm editorial accents)
  const SPLIT_COLORS = ["var(--violet)", "var(--cyan)", "var(--magenta)", "var(--green)", "var(--salmon)", "var(--amber)"];
  const splitRows = bounties.filter((b) => (b.revenue_percent ?? 0) > 0);
  const producerPercent = Math.max(0, 100 - totalAssigned - 3);
  const splitSegments = [
    { label: "Producer", percent: producerPercent, color: "var(--paper-200)" },
    ...splitRows.map((b, i) => ({ label: b.title, percent: b.revenue_percent ?? 0, color: SPLIT_COLORS[i % SPLIT_COLORS.length] })),
    { label: "Platform fee", percent: 3, color: "var(--paper-600)" },
  ];

  async function handleSendChat(textToSend?: string) {
    const prompt = textToSend || chatInput;
    if (!prompt.trim() || sendingChat) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: "user",
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setSendingChat(true);

    // Add initial reasoning thinking message
    const directorMsgId = crypto.randomUUID();
    const initMsg: ChatMessage = {
      id: directorMsgId,
      sender: "director",
      text: "",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isThinking: true,
    };
    setMessages((prev) => [...prev, initMsg]);

    try {
      const lower = prompt.toLowerCase();

      // Priority 1 — Coaching (most specific keywords)
      const isCoaching =
        lower.includes("coach") ||
        lower.includes("advice") ||
        lower.includes("health") ||
        lower.includes("recommendation") ||
        (lower.includes("project") && (lower.includes("coach") || lower.includes("advice"))) ||
        (lower.includes("workspace") && !lower.includes("plan") && !lower.includes("build") && !lower.includes("decompose"));

      // Priority 2 — Character/location ADD request: "add a character named X…"
      // must become a REAL memory update (persisted to Creative Memory), not a
      // generic story card with stale characters.
      const isCharacterAdd = /^\s*(add|create|introduce|include)\s+(a\s+|an\s+|the\s+)?(new\s+)?(character|hero|villain|antagonist|protagonist|detective|npc)/i.test(
        prompt
      );

      // Priority 3 — Backstory / Lore (only when explicitly asking for narrative
      // content — a bare "character" mention inside an add-request never lands here)
      const isBackstory =
        !isCoaching &&
        !isCharacterAdd && (
          lower.includes("backstory") ||
          lower.includes("story") ||
          lower.includes("lore") ||
          /^(write|generate|give me|describe|tell me)\b/.test(lower) && (lower.includes("world") || lower.includes("dialogue") || lower.includes("character"))
        );

      // Priority 4 — Production Planning (only specific intent words)
      const isPlanning =
        !isCoaching && !isBackstory && !isCharacterAdd && (
          lower.includes("decompose") ||
          lower.includes("roadmap") ||
          lower.includes("production plan") ||
          lower.includes("want to build") ||
          lower.includes("plan") ||
          lower.startsWith("build") ||
          (lower.includes("make") && lower.includes("plan"))
        );

      // Simulate a thinking delay to make Foundry feel like it is reasoning
      await new Promise((r) => setTimeout(r, 1200));

      if (isPlanning) {
        let cleanIdea = prompt;
        cleanIdea = cleanIdea.replace(/^(decompose:|plan:|decompose\b|plan\b)/i, "").trim();
        cleanIdea = cleanIdea.replace(/^(create a production plan for|create production plan for|generate production plan for|create plan for|generate plan for|give me a roadmap for|roadmap for|setup workspace for)/i, "").trim();
        cleanIdea = cleanIdea.replace(/^(my|a|an)\s+/i, "").trim();
        // When the producer says "plan this/based on what we agreed", the idea is
        // the PROJECT itself — fall back to title + description so genre
        // detection reads the project, not the bare instruction.
        const isProjectPlanning = !cleanIdea || /^(this|the)\s+(project|current)/i.test(cleanIdea) || /based on (everything|our|the) (we |)agree/i.test(prompt) || /^plan this project$/i.test(prompt.trim());
        if (!cleanIdea || isProjectPlanning) {
          cleanIdea = `${work.title}: ${work.description || ""}`.trim();
        }
        setPendingConcept(cleanIdea);

        // Genre detection over the project brief (title+description) PLUS the
        // recent conversation, so "noir detective" in chat can also steer it.
        const genreText = `${cleanIdea} ${work.title} ${work.description || ""} ${messages.slice(-6).map((m) => m.text.slice(0, 200)).join(" ")}`.toLowerCase();

        let assumedGenre = "Narrative Adventure Game";
        let assumedArt = "Stylized digital illustration, moody lighting";
        if (/cyberpunk|neon|dystopian|cyber\b|hacker|mega-?city/.test(genreText)) {
          assumedGenre = "Cyberpunk Action RPG";
          assumedArt = "Synthwave / Neon Cyberpunk";
        } else if (/stealth|smuggl|courier|infiltrat|spy|heist|assassin/.test(genreText)) {
          assumedGenre = "Cyberpunk Stealth Game";
          assumedArt = "Synthwave / Neon Cyberpunk";
        } else if (/pixel|platformer|arcade|8-bit|16-bit|retro/.test(genreText)) {
          assumedGenre = "16-Bit Pixel Platformer";
          assumedArt = "Hand-drawn pixel art with modern glow accents";
        } else if (/fantasy|medieval|rpg|dungeon|knight|magic/.test(genreText)) {
          assumedGenre = "Medieval Fantasy RPG";
          assumedArt = "16-Bit Pixel Art with Glowing Gradients";
        } else if (/horror|creepy|scary|ghost/.test(genreText)) {
          assumedGenre = "Atmospheric Horror Platformer";
          assumedArt = "Dark Digital Illustrative / Monochromatic";
        } else if (/music|soundtrack|song|album|synthwave|lofi/.test(genreText)) {
          assumedGenre = "Synthwave Music Tracks compilation";
          assumedArt = "Retro 80s aesthetic";
        } else if (/racing|driving|car\b/.test(genreText)) {
          assumedGenre = "Cyberpunk Racing Game";
          assumedArt = "Synthwave / Neon Cyberpunk";
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === directorMsgId
              ? {
                  ...m,
                  isThinking: false,
                  text: `Interesting concept. Before I generate the production plan, I have formulated these assumptions:

• Target Genre: ${assumedGenre}
• Art Style: ${assumedArt}
• Estimated Team Size: 5–8 creators
• Estimated Production Time: 8 weeks

Does this look correct? Please click "Generate Production Plan" below to proceed.`,
                }
              : m
          )
        );
        setSendingChat(false);

      } else if (isBackstory) {
        const data = await apiPost<{ response: string }>("/api/ai/story", {
          idea: work.title ? `${work.title}: ${work.description || ""}` : prompt,
          prompt,
        });

        // Derive story card from the server's project-grounded response (and the
        // project's creative memory) — generic template only as last resort.
        let world = work.description
          ? `The world of “${work.title}” — ${work.description.slice(0, 140)}${work.description.length > 140 ? "…" : ""}`
          : "Define a project description so the story engine can ground itself.";
        let conflict = "The central tension of your brief — sharpen it into one sentence.";
        let narrative = "Build the first episode around the choice your protagonist can't take back.";
        let dialogueStyle = "Natural and character-first.";
        let tone = "Tone follows your brief's genre.";
        let characters: { name: string; role: string; desc: string }[] = memory?.characters?.length
          ? memory.characters.slice(0, 3).map((c) => ({
              name: c.name,
              role: c.role,
              desc: c.description,
            }))
          : [{ name: "The Protagonist", role: "Primary Character", desc: "Carries the question the piece asks." }];

        const text = data.response;
        const worldMatch = text.match(/Art World:\s*([^\n]+)/i) || text.match(/World:\s*([^\n]+)/i) || text.match(/\*\*World\*\*:\s*([^\n]+)/i) || text.match(/\*\*Art World\*\*:\s*([^\n]+)/i);
        if (worldMatch) world = worldMatch[1].trim();
        const conflictMatch = text.match(/Story Direction:\s*([^\n]+)/i) || text.match(/Conflict:\s*([^\n]+)/i) || text.match(/\*\*Conflict\*\*:\s*([^\n]+)/i) || text.match(/\*\*Story Direction\*\*:\s*([^\n]+)/i);
        if (conflictMatch) conflict = conflictMatch[1].trim();
        const toneMatch = text.match(/Tone:\s*([^\n]+)/i) || text.match(/\*\*Tone\*\*:\s*([^\n]+)/i);
        if (toneMatch) tone = toneMatch[1].trim();
        const dialogueMatch = text.match(/Dialogue(?:\s+Style)?:\s*([^\n]+)/i) || text.match(/\*\*Dialogue(?:\s+Style)?\*\*:\s*([^\n]+)/i);
        if (dialogueMatch) dialogueStyle = dialogueMatch[1].trim();
        else if (memory?.dialogueTone) dialogueStyle = memory.dialogueTone;
        const narrativeMatch = text.match(/Narrative:\s*([^\n]+)/i) || text.match(/\*\*Narrative\*\*:\s*([^\n]+)/i);
        if (narrativeMatch) narrative = narrativeMatch[1].trim();

        setMessages((prev) =>
          prev.map((m) =>
            m.id === directorMsgId
              ? {
                  ...m,
                  isThinking: false,
                  isStoryCard: true,
                  storyData: {
                    summary: "Backstory derived from this project's brief and Creative Memory Canvas.",
                    world,
                    characters,
                    conflict,
                    narrative,
                    dialogueStyle,
                    tone,
                  },
                }
              : m
          )
        );
        setSendingChat(false);

      } else if (isCoaching) {
        // Coaching card — computed from the REAL bounty board, not static numbers
        const bs = board?.bounties ?? [];
        const total = bs.length;
        const minted = bs.filter((b) => b.status === "minted").length;
        const open = bs.filter((b) => b.status === "open").length;
        const inFlight = total - minted - open;
        const progress = total === 0 ? 0 : Math.round((minted / total) * 100);
        const missingShort = bs.filter((b) => b.status === "open").map((b) => b.title).slice(0, 3);
        const visualBounties = bs.filter(
          (b) => (b.role === "concept_artist" || b.role === "modeler") && b.status === "minted"
        );
        const visualCons = visualBounties.length > 0 ? "92% (Aligned)" : "No audits yet";

        const recommendations: string[] = [];
        if (total === 0) recommendations.push("Generate a production plan to create the first bounties");
        if (open > 0) recommendations.push(`${open} open bounty(ies) — share the Contributor Hub link to get them claimed`);
        if (inFlight > 0) recommendations.push(`${inFlight} bounty(ies) claimed/delivered — review and approve to unblock minting`);
        if (total > 0 && minted === total) recommendations.push("All bounties minted — run Seal Splits to commit revenue shares on-chain");
        if (visualBounties.length === 0 && total > 0) recommendations.push("No minted visual assets yet — approve one concept-art bounty to establish the style baseline");

        setMessages((prev) =>
          prev.map((m) =>
            m.id === directorMsgId
              ? {
                  ...m,
                  isThinking: false,
                  isCoachingCard: true,
                  coachingData: {
                    status: total === 0 ? "Planning" : minted === total ? "Ready to Seal" : "Creative Execution",
                    progress,
                    timeline: progress >= 75 ? "On Track" : progress >= 25 ? "In Progress" : "Early Stage",
                    visualConsistency: visualCons,
                    missingDeliverables: missingShort,
                    recommendations: recommendations.slice(0, 4),
                  },
                }
              : m
          )
        );
        setSendingChat(false);

      } else if (isCharacterAdd && memory) {
        // Derive the character name from the request, persist into Creative Memory
        const nameMatch = prompt.match(/(?:called|named|name[d]?)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)?)/);
        const charName = nameMatch ? nameMatch[1] : `New Character ${memory.characters.length + 1}`;
        const lowerDesc = prompt.toLowerCase();
        const roleGuess = /detective|inspector|investigator|sleuth/.test(lowerDesc)
          ? "Investigator"
          : /villain|antagonist|enemy|crime lord|black market boss/.test(lowerDesc)
            ? "Antagonist"
            : "Support Character";
        const updatedMemory = {
          ...memory,
          characters: [
            ...memory.characters,
            {
              name: charName,
              role: roleGuess,
              description: prompt.replace(/^\s*(add|create|introduce|include)\s+(a\s+|an\s+|the\s+)?(new\s+)?(character|hero|villain|antagonist|protagonist|detective|npc)\s*/i, "").replace(/^(called|named)\s+/i, "").trim() || `Requested via Director chat.`,
            },
          ],
        };
        try {
          await apiPost("/api/ai/memory", { workId, memory: updatedMemory, wallet: address });
          setMemory(updatedMemory);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === directorMsgId
                ? {
                    ...m,
                    isThinking: false,
                    text: `✅ Added **${charName}** (${roleGuess}) to the project's Creative Memory Canvas — they now appear in the Visual Memory panel and will be considered in every future plan, story, and critic review. Want me to adjust their description?`,
                  }
                : m
            )
          );
        } catch {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === directorMsgId
                ? { ...m, isThinking: false, text: `I couldn't save ${charName} to memory — please try again.` }
                : m
            )
          );
        }
        setSendingChat(false);

      } else {
        const data = await apiPost<{ response: string }>("/api/ai/chat", {
          prompt,
          workId,
          wallet: address,
        });

        setMessages((prev) =>
          prev.map((m) =>
            m.id === directorMsgId
              ? {
                  ...m,
                  isThinking: false,
                  text: data.response,
                }
              : m
          )
        );
        setSendingChat(false);
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === directorMsgId
            ? {
                ...m,
                isThinking: false,
                text: "Apologies, I encountered an issue processing that query. Please try again.",
              }
            : m
        )
      );
      setSendingChat(false);
    }
  }

  // Execute progressive reasoning logs followed by visual summary card output
  async function executePlanningFlow() {
    if (!pendingConcept || sendingChat) return;
    const cleanIdea = pendingConcept;
    setPendingConcept(null);
    setSendingChat(true);
    setPlanningAnimationComplete(false);

    // Genre detection over the full project context (idea + title + description
    // + recent chat), cyberpunk/stealth checked FIRST so "action RPG" in the
    // title can't misfire the fantasy branch.
    const genreText = `${cleanIdea} ${work.title} ${work.description || ""} ${messages.slice(-6).map((m) => m.text.slice(0, 200)).join(" ")}`.toLowerCase();
    let assumedGenre = "Narrative Adventure Game";
    let assumedArt = "Stylized digital illustration, moody lighting";
    if (/cyberpunk|neon|dystopian|cyber\b|hacker|mega-?city/.test(genreText)) {
      assumedGenre = "Cyberpunk Action RPG";
      assumedArt = "Synthwave / Neon Cyberpunk";
    } else if (/stealth|smuggl|courier|infiltrat|spy|heist|assassin/.test(genreText)) {
      assumedGenre = "Cyberpunk Stealth Game";
      assumedArt = "Synthwave / Neon Cyberpunk";
    } else if (/pixel|platformer|arcade|8-bit|16-bit|retro/.test(genreText)) {
      assumedGenre = "16-Bit Pixel Platformer";
      assumedArt = "Hand-drawn pixel art with modern glow accents";
    } else if (/fantasy|medieval|dungeon|knight|magic/.test(genreText)) {
      assumedGenre = "Medieval Fantasy RPG";
      assumedArt = "16-Bit Pixel Art with Glowing Gradients";
    } else if (/horror|creepy|scary|ghost/.test(genreText)) {
      assumedGenre = "Atmospheric Horror Platformer";
      assumedArt = "Dark Digital Illustrative / Monochromatic";
    } else if (/music|soundtrack|song|album|synthwave|lofi/.test(genreText)) {
      assumedGenre = "Synthwave Music Tracks compilation";
      assumedArt = "Retro 80s aesthetic";
    } else if (/racing|driving|car\b/.test(genreText)) {
      assumedGenre = "Cyberpunk Racing Game";
      assumedArt = "Synthwave / Neon Cyberpunk";
    }

    // Step 1: Add initial reasoning log
    const reasoningMsgId = crypto.randomUUID();
    const initMsg: ChatMessage = {
      id: reasoningMsgId,
      sender: "director",
      text: "🧠 [Foundry Intelligence Reasoning] Initiating Creative Planner Agent...",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reasoningStep: 0,
    };
    setMessages((prev) => [...prev, initMsg]);

    try {
      // Include the chat conversation so the plan reflects what the producer
      // actually discussed (client ↔ director), not just the raw brief.
      const conversationContext = messages
        .filter((m) => !m.isThinking && m.text)
        .slice(-12)
        .map((m) => `${m.sender === "director" ? "AI Director" : "Producer"}: ${m.text.slice(0, 500)}`)
        .join("\n\n");

      // Fetch plan from actual API first
      const data = await apiPost<{ plan: ProductionPlan }>("/api/ai/director", {
        idea: cleanIdea,
        workId,
        wallet: address,
        conversationContext,
      });

      // Set states — normalize LLM-generated roles to the canonical set so the
      // editor's role dropdown binds correctly (LLMs return "composer",
      // "narrative_writer", "3d_modeling"; the app's canonical roles are
      // musician/writer/modeler…). Phase cards display the ORIGINAL label.
      const normalizeRole = (role: string): string => {
        const r = (role || "").toLowerCase().replace(/[\s-]+/g, "_");
        if ((ROLES as string[]).includes(r)) return r;
        if (/concept|illustrat|2d/.test(r)) return "concept_artist";
        if (/3d|model/.test(r)) return "modeler";
        if (/anim|rig|motion/.test(r)) return "animator";
        if (/music|compos|audio|sound|score/.test(r)) return "musician";
        if (/writ|narrat|script|dialog|story/.test(r)) return "writer";
        if (/program|dev\b|engineer|code/.test(r)) return "programmer";
        return "other";
      };
      const normalizedPlan: ProductionPlan = {
        ...data.plan,
        suggestedBounties: data.plan.suggestedBounties.map((b) => ({ ...b, role: normalizeRole(b.role) })),
      };
      setDraftPlan(normalizedPlan);
      if (data.plan.inspiration) {
        // MERGE the plan's creative direction into the existing memory — never
        // overwrite characters/locations the producer built up in chat (e.g.
        // characters added via "Add a detective called…").
        const planMemory: CreativeMemory = {
          characters: memory?.characters?.length
            ? memory.characters
            : [
                { name: "Hero / Protagonist", role: "Primary Character", description: "Wears distinctive theme gear." },
                { name: "Support Guide", role: "Narrative operator", description: "Guides user workflow prompts." },
              ],
          locations: memory?.locations?.length ? memory.locations : ["Core Zone", "Sector District Hub"],
          artStyle: data.plan.inspiration.visualReferences[0] || memory?.artStyle || "Custom style",
          musicProfile: data.plan.inspiration.musicMood || memory?.musicProfile || "Electronic tracks",
          dialogueTone: memory?.dialogueTone || "Collaborative, detailed",
          brandColors: data.plan.inspiration.colors?.length ? data.plan.inspiration.colors : (memory?.brandColors || []),
        };
        setMemory(planMemory);
        // Persist the merge so the canvas + future AI calls all agree
        apiPost("/api/ai/memory", { workId, memory: planMemory, wallet: address }).catch(() => {});
      }

      // Progressively animate reasoning checkmarks
      for (let step = 1; step <= 9; step++) {
        await new Promise((r) => setTimeout(r, 350));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === reasoningMsgId
              ? { ...m, reasoningStep: step }
              : m
          )
        );
      }

      const deliverables = normalizedPlan.suggestedBounties.map((b) => b.title) || [];
      const phases = data.plan.suggestedBounties.map((b, idx) => ({
        phase: `Phase ${idx + 1}`,
        title: b.title,
        role: b.role.replace(/_/g, " "),
        reward: `${b.rewardEth} USDG`,
        split: `${b.revenuePercent}%`,
        status: "Ready",
      }));

      // Render Summary Card + Creative Roadmap
      setMessages((prev) =>
        prev.map((m) =>
          m.id === reasoningMsgId
            ? {
                ...m,
                reasoningStep: undefined,
                isPlanSummary: true,
                planData: {
                  title: data.plan.title,
                  genre: assumedGenre,
                  artStyle: assumedArt,
                  timeline: "8 Weeks",
                  teamSize: "6 Creators",
                  deliverables,
                  phases,
                },
              }
            : m
        )
      );

      // Unlock populate button
      setPlanningAnimationComplete(true);
      setSendingChat(false);
    } catch (e) {
      console.error(e);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === reasoningMsgId
            ? {
                ...m,
                reasoningStep: undefined,
                text: "❌ Apologies, I encountered an issue processing that query. Please try again.",
              }
            : m
        )
      );
      setSendingChat(false);
    }
  }

  // Populate actual board database with custom edited items
  async function approveAndPopulate() {
    if (!draftPlan || populatingTasks || !isProducer) return;
    setPopulatingTasks(true);
    setPopulateStepIndex(0);
    try {
      // Step 0: ✓ Creating deliverables...
      await new Promise((r) => setTimeout(r, 600));
      setPopulateStepIndex(1);
      
      await apiPost("/api/ai/populate", {
        workId,
        bounties: draftPlan.suggestedBounties,
        wallet: address,
      });

      // Step 1: ✓ Building workspace...
      await new Promise((r) => setTimeout(r, 600));
      setPopulateStepIndex(2);

      // Step 2: ✓ Synchronizing creative memory...
      await new Promise((r) => setTimeout(r, 600));
      setPopulateStepIndex(3);

      if (memory) {
        await apiPost("/api/ai/memory", { workId, memory, wallet: address });
      }

      // Step 3: ✓ Workspace ready
      await new Promise((r) => setTimeout(r, 600));
      setPopulateStepIndex(4);
      await new Promise((r) => setTimeout(r, 400));

      // Append Success message to Director chat
      const successMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: "director",
        text: `✅ Production plan approved.

Your collaborative workspace has been generated successfully.

All suggested deliverables are now available on the Workspace Board where creators can immediately begin claiming work.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, successMsg]);

      setDraftPlan(null);
      setActiveView("board");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to populate workboard");
    } finally {
      setPopulatingTasks(false);
    }
  }

  // Edit suggested task fields (human-in-the-loop)
  function handleEditDraftBounty(index: number, field: keyof SuggestedBounty, value: any) {
    if (!draftPlan) return;
    const list = [...draftPlan.suggestedBounties];
    list[index] = {
      ...list[index],
      [field]: field === "rewardEth" || field === "revenuePercent" ? Number(value) : value,
    };
    setDraftPlan({ ...draftPlan, suggestedBounties: list });
  }

  function handleDeleteDraftBounty(index: number) {
    if (!draftPlan) return;
    const list = draftPlan.suggestedBounties.filter((_, i) => i !== index);
    setDraftPlan({ ...draftPlan, suggestedBounties: list });
  }

  return (
    <div>
      {/* Breadcrumb + chain status */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href="/works"
          className="group inline-flex items-center gap-1.5 text-[13px] text-t3 font-medium hover:text-t1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
          Back to Works
        </Link>
        <span className="pill font-mono text-[11px] tracking-wide">
          <span className={`w-1.5 h-1.5 rounded-full ${work.asset_contract ? "bg-verified" : "bg-t4"}`} />
          {work.asset_contract ? "On-chain · Robinhood Chain Testnet" : "Off-chain draft"}
        </span>
      </div>

      {/* Hero Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="rf-display text-3xl md:text-4xl text-t1">{work.title}</h1>
              <WorkStatusPill status={work.status} />
            </div>
            <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-t2">
              {work.description || "No project overview. Ask Production AI to plan your roadmap."}
            </p>
            {(work.asset_contract || (work.status === "sealed" && work.work_contract)) && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {work.asset_contract && (
                  <span className="pill font-mono text-[11px]">
                    <span className="text-t4">Asset Contract</span>
                    <Address value={work.asset_contract} link />
                  </span>
                )}
                {work.status === "sealed" && work.work_contract && (
                  <span className="pill border-verified/25 bg-verified-subtle font-mono text-[11px] text-verified">
                    <span className="opacity-70">Release Contract</span>
                    <Address value={work.work_contract} link />
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2">
            {work.status === "sealed" ? (
              <Link href={`/work/${work.slug || work.id}/store`} className="btn-primary px-5 py-2.5 text-sm shadow-glow-accent">
                Go to Store
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            ) : (
              isProducer && (
                <Link
                  href={canSeal ? `/work/${work.slug || work.id}/seal` : "#"}
                  className={`btn text-sm font-semibold px-5 py-2.5 ${
                    canSeal
                      ? "btn-primary shadow-glow-accent"
                      : "btn-ghost cursor-not-allowed opacity-60"
                  }`}
                  aria-disabled={!canSeal}
                  onClick={(e) => !canSeal && e.preventDefault()}
                  style={!canSeal ? { pointerEvents: "none" } : undefined}
                  title={canSeal ? undefined : "Complete every deliverable first"}
                >
                  <Lock className="w-3.5 h-3.5" />
                  {canSeal ? "Publish Project" : "Publish · locked"}
                </Link>
              )
            )}
            {!canSeal && work.status === "open" && bounties.length > 0 && (
              <span className="text-center text-[11px] text-t4">
                {mintedCount} of {bounties.length} deliverables finalized
              </span>
            )}
            {work.status === "open" && work.work_contract && (
              <span className="pill mx-auto border-verified/25 bg-verified-subtle text-[11px] text-verified">
                Published
              </span>
            )}
          </div>
        </div>
        <div className="mt-7 h-px w-full bg-[color:var(--border-subtle)]" />
      </div>

      {/* View Toggle — segmented control */}
      <div className="mb-8 inline-flex rounded-full border border-[color:var(--border-subtle)] bg-surface-inset p-1">
        {([
          { id: "board" as const, label: "Production Workspace", icon: LayoutDashboard },
          { id: "director" as const, label: "Production AI", icon: Sparkles },
        ]).map((tab) => {
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-all ${
                isActive
                  ? "bg-accent text-on-accent shadow-sm"
                  : "text-t3 hover:text-t1"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* VIEW 1: Production Workspace & Health Dashboard */}
      {activeView === "board" && (
        <div className="space-y-6">

          {/* Project Health — stat tiles */}
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="card min-w-[260px] flex-1 p-4">
              <div className="flex items-center justify-between">
                <span className="rf-eyebrow">Completion</span>
                <span className="rf-data text-sm font-semibold text-t1">{completionPercent}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-inset">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent to-info transition-all duration-700 ease-out"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>
            {[
              { label: "Readiness", value: readinessLabel, wide: true },
              { label: "Tasks", value: `${bounties.length}`, mono: true },
              { label: "Completed", value: `${bounties.filter(b => b.status === 'minted').length}`, mono: true, tone: "text-success" },
              { label: "In Review", value: `${bounties.filter(b => b.status === 'delivered').length}`, mono: true, tone: "text-warning" },
              { label: "Open", value: `${bounties.filter(b => b.status === 'open').length}`, mono: true, tone: "text-info" },
            ].map((m) => (
              <div key={m.label} className={`card p-4 flex-1 ${m.wide ? "min-w-[186px]" : "min-w-[124px]"}`}>
                <span className="rf-eyebrow">{m.label}</span>
                <div className={`mt-2 font-semibold text-t1 ${m.wide ? "text-[15px] leading-snug" : "rf-data text-lg"} ${m.tone ?? ""}`}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Missing categories */}
          {missingAssets.length > 0 && (
            <div className="card flex flex-wrap items-center gap-3 border-warning/25 bg-warning-subtle px-5 py-3.5">
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-warning">
                <AlertTriangle className="w-4 h-4" />
                Missing
              </span>
              <div className="flex flex-wrap gap-2">
                {missingAssets.map((asset, i) => (
                  <span key={i} className="pill border-warning/25 bg-warning-subtle text-[12px] font-semibold text-warning">
                    {asset}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Splits Panel */}
          {work.status === "sealed" && (
            <div className="card p-6 shadow-glow-prism">
              <div className="mb-4 flex items-baseline justify-between">
                <span className="rf-eyebrow">On-Chain Royalty Shares</span>
                <span className="rf-data text-[11px] text-t4">Arbitrum Configured</span>
              </div>
              <RoyaltyTable rows={royaltyRows} />
            </div>
          )}

          {/* Timeline & Bounties Grid */}
          <div className="grid lg:grid-cols-[1fr_minmax(360px,420px)] gap-8">
            
            {/* Left/Middle Columns: Tasks & Details */}
            <div className="space-y-5 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-baseline gap-3">
                  <h2 className="rf-display text-2xl text-t1">Production Tasks</h2>
                  {bounties.length > 0 && (
                    <span className="rf-data text-[13px] text-t4">{bounties.length} total</span>
                  )}
                </div>
                {isProducer && work.status === "open" && (
                  <button className="btn-ghost px-3.5 py-1.5 text-[13px]" onClick={() => setOpenBountyOpen(true)}>
                    <Plus className="w-3.5 h-3.5" />
                    Add Task
                  </button>
                )}
              </div>

              {bounties.length === 0 ? (
                <div className="card flex flex-col items-center gap-3 py-14 text-center">
                  <div className="w-11 h-11 rounded-full bg-accent-subtle flex items-center justify-center">
                    <ClipboardList className="w-5 h-5 text-accent" />
                  </div>
                  <p className="text-[15px] font-medium text-t2">
                    Foundry has not generated a workspace yet.
                  </p>
                  <p className="text-[13px] text-t4">Generate a Production Plan to begin.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {bounties.map((b) => (
                    <BountyRow
                      key={b.id}
                      bounty={b}
                      isProducer={isProducer}
                      escrow={escrows[b.id] ?? null}
                      walletAddr={address ?? ""}
                      onReview={() => setReviewing(b)}
                      onLock={() => setLockingBounty(b)}
                      onChanged={() => load()}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Activity Feed */}
            <div className="space-y-5 min-w-0">
              <div className="card p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-accent" />
                    <h3 className="text-[15px] font-semibold text-t1">Activity</h3>
                  </div>
                  {bounties.length > 0 && (
                    <span className="pill rf-data text-[11px]">{bounties.length} tasks</span>
                  )}
                </div>

                <div>
                  {activityEvents.map((ev, i) => {
                    const isLast = i === activityEvents.length - 1;
                    return (
                      <div key={i} className="relative pb-5 pl-9 last:pb-0">
                        {!isLast && (
                          <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[color:var(--border-subtle)]" />
                        )}
                        <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-[color:var(--border-subtle)] bg-surface-inset">
                          <ev.icon className={`w-3.5 h-3.5 ${ev.tone}`} />
                        </span>
                        {ev.group && (
                          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
                            <FileText className="w-3 h-3 shrink-0" />
                            <span className="truncate">{ev.group}</span>
                          </div>
                        )}
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-semibold leading-snug text-t1">{ev.title}</span>
                          <span className="pill shrink-0 px-2 py-0 text-[11px]">{ev.tag}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-t3">{ev.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Royalty Split Preview — live math of who gets what at seal time */}
              <div className="card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-accent" />
                    <h3 className="text-[15px] font-semibold text-t1">Royalty Split</h3>
                  </div>
                  <span className="pill rf-data text-[11px]">{totalAssigned}% committed</span>
                </div>

                {/* Stacked allocation bar */}
                <div className="mb-4 flex h-2 w-full overflow-hidden rounded-full bg-surface-inset">
                  {splitSegments.map((seg, i) => (
                    <span
                      key={i}
                      title={`${seg.label} · ${seg.percent}%`}
                      style={{ width: `${seg.percent}%`, backgroundColor: seg.color }}
                      className="h-full transition-all"
                    />
                  ))}
                </div>

                <div className="space-y-2.5">
                  {splitSegments.map((seg, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="truncate text-t3" title={seg.label}>
                          {seg.label}
                          {seg.label === "Producer" && <span className="text-t4"> (you)</span>}
                        </span>
                      </span>
                      <span className="rf-data shrink-0 font-semibold text-t1">{seg.percent}%</span>
                    </div>
                  ))}
                </div>

                {work.status !== "sealed" && (
                  <p className="mt-4 border-t border-[color:var(--border-subtle)] pt-3 text-[11px] leading-relaxed text-t4">
                    Preview only — shares are committed immutably on-chain when every task is
                    minted and you publish.
                  </p>
                )}
              </div>

              <RoyaltyRevenueCard sealed={work.status === "sealed"} />
            </div>

          </div>
        </div>
      )}

      {/* VIEW 2: Production AI Chat Studio */}
      {activeView === "director" && (
        <>
          <div className="grid lg:grid-cols-5 gap-8 items-start">
          {/* Chat Terminal Interface */}
          <div className="lg:col-span-3 xl:col-span-3 card bg-surface-inset border border-[color:var(--border-subtle)] flex flex-col h-[clamp(480px,62vh,660px)] p-0 overflow-hidden rounded-xl">
            <div className="bg-surface-raised border-b border-[color:var(--border-subtle)] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-info animate-pulse" />
                <span className="font-display text-sm text-t1 font-bold">AI Command Center</span>
              </div>
              <span className="text-[11px] text-t4 uppercase tracking-wider font-mono">Foundry v3 Agent</span>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => {
                const isUser = msg.sender === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-[90%] ${
                      isUser ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    <span className="text-[11px] text-t4 font-semibold mb-1">
                      {isUser ? "Creator" : "Foundry Production Assistant"}
                    </span>
                    
                    {msg.isThinking ? (
                      <div className="card bg-surface-raised border border-[color:var(--border-subtle)] p-4 rounded-xl rounded-tl-none space-y-3 w-full max-w-sm animate-pulse">
                        <div className="flex items-center gap-2 font-display text-xs text-t2 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                          <span>Foundry Intelligence is thinking...</span>
                        </div>
                        <div className="space-y-2">
                          <div className="h-2.5 bg-surface-inset rounded w-5/6"></div>
                          <div className="h-2 bg-surface-inset rounded w-2/3"></div>
                          <div className="h-2 bg-surface-inset rounded w-1/2"></div>
                        </div>
                      </div>
                    ) : msg.isPlanSummary && msg.planData ? (
                      <div className="space-y-3.5 w-full max-w-md md:max-w-lg">
                        
                        {/* Reasoning Stepper (Completed list) */}
                        <div className="card bg-surface-raised/40 border border-[color:var(--border-subtle)] p-4 rounded-xl space-y-2 text-xs font-mono">
                          <div className="flex items-center gap-2 font-display text-xs text-t1 font-bold">
                            <Brain className="w-4 h-4 text-accent" /> Foundry Production Assistant
                          </div>
                          <div className="text-[11px] text-success font-bold">✓ Creative Analysis Completed</div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-t3">
                            <div>✓ Understanding project</div>
                            <div>✓ Identifying genre</div>
                            <div>✓ Detecting creative roles</div>
                            <div>✓ Estimating production scope</div>
                            <div>✓ Building roadmap</div>
                            <div>✓ Generating deliverables</div>
                            <div>✓ Calculating creator rewards</div>
                            <div>✓ Computing royalty splits</div>
                            <div>✓ Preparing workspace</div>
                          </div>
                        </div>

                        {/* Project Summary Card */}
                        <div className="card bg-gradient-to-br from-card to-surface-raised/80 border border-[color:var(--border)] p-5 rounded-xl shadow-glow-prism space-y-4">
                          <div className="border-b border-[color:var(--border-subtle)] pb-2">
                            <span className="text-[10px] uppercase tracking-wider text-accent font-bold">Project Profile Card</span>
                            <h4 className="font-display text-sm text-t1 font-bold leading-tight mt-0.5">{msg.planData.title}</h4>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <div className="text-t4 text-[10px] uppercase font-bold">Genre</div>
                              <div className="text-t2 font-medium mt-0.5">{msg.planData.genre}</div>
                            </div>
                            <div>
                              <div className="text-t4 text-[10px] uppercase font-bold">Timeline</div>
                              <div className="text-t2 font-medium mt-0.5">{msg.planData.timeline}</div>
                            </div>
                            <div>
                              <div className="text-t4 text-[10px] uppercase font-bold">Recommended Team</div>
                              <div className="text-t2 font-medium mt-0.5">{msg.planData.teamSize}</div>
                            </div>
                            <div>
                              <div className="text-t4 text-[10px] uppercase font-bold">Complexity</div>
                              <div className="text-t2 font-medium mt-0.5">Medium</div>
                            </div>
                          </div>

                          <div className="border-t border-[color:var(--border-subtle)] pt-3">
                            <div className="text-t4 text-[10px] uppercase font-bold mb-1.5">Suggested Deliverables</div>
                            <div className="flex flex-wrap gap-1.5">
                              {msg.planData.deliverables.map((del, idx) => (
                                <span key={idx} className="bg-surface-inset text-[10px] text-t3 border border-[color:var(--border-subtle)] px-2 py-0.5 rounded font-mono">
                                  ✓ {del}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Creative Roadmap Cards */}
                        <div className="space-y-2">
                          <h5 className="font-display text-xs text-t1 font-bold uppercase tracking-wider">🗺️ Suggested Creative Roadmap</h5>
                          {msg.planData.phases.map((ph, idx) => (
                            <div key={idx} className="card bg-card/60 border border-[color:var(--border-subtle)] p-3.5 rounded-xl space-y-2.5 hover:border-accent/35 transition-all duration-300">
                              <div className="flex justify-between items-center">
                                <div>
                                  <span className="text-[10px] text-t4 font-mono uppercase tracking-wider">{ph.phase}</span>
                                  <h6 className="font-bold text-t1 text-xs">{ph.title}</h6>
                                </div>
                                <span className="text-[10px] bg-success/15 text-success border border-success/20 px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider">
                                  {ph.status}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 border-t border-[color:var(--border-subtle)] pt-2 text-[11px]">
                                <div>
                                  <span className="text-t4 block">Recommended Role</span>
                                  <span className="text-info font-bold uppercase tracking-wider text-[10px]">{ph.role}</span>
                                </div>
                                <div>
                                  <span className="text-t4 block">Contributor Reward</span>
                                  <span className="text-t2 font-semibold font-mono">{ph.reward}</span>
                                </div>
                                <div>
                                  <span className="text-t4 block">Royalty Share</span>
                                  <span className="text-accent font-semibold font-mono">{ph.split}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                      </div>
                    ) : msg.isCoachingCard && msg.coachingData ? (
                      <div className="card bg-gradient-to-br from-card/90 to-surface-inset/80 border border-accent/20 p-5 rounded-xl shadow-glow-prism space-y-4 w-full max-w-md">
                        <div className="flex justify-between items-center border-b border-[color:var(--border-subtle)] pb-2.5">
                          <div>
                            <span className="text-[10px] uppercase tracking-wider text-accent font-bold">Workspace Analysis Card</span>
                            <h4 className="font-display text-sm text-t1 font-bold">Project Status</h4>
                          </div>
                          <span className="text-[10px] font-mono font-bold bg-success/10 text-success border border-success/20 px-2 py-0.5 rounded uppercase tracking-wider">
                            Sync Connected
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3.5 text-xs">
                          <div>
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold">Project Status</div>
                            <div className="text-t2 font-semibold mt-0.5">{msg.coachingData.status}</div>
                          </div>
                          <div>
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold">Timeline</div>
                            <div className="text-success font-semibold mt-0.5">✓ {msg.coachingData.timeline}</div>
                          </div>
                          <div>
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold">Visual Consistency</div>
                            <div className="text-accent font-semibold mt-0.5 font-mono">{msg.coachingData.visualConsistency}</div>
                          </div>
                          <div>
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold font-mono">Progress</div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="w-full bg-surface-inset rounded-full h-1.5 overflow-hidden border border-[color:var(--border-subtle)]">
                                <div className="bg-gradient-to-r from-accent to-info h-full" style={{ width: `${msg.coachingData.progress}%` }}></div>
                              </div>
                              <span className="text-[11px] font-bold text-t2 font-mono">{msg.coachingData.progress}%</span>
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-[color:var(--border-subtle)] pt-3">
                          <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-2">⚠️ Missing Deliverables</div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.coachingData.missingDeliverables.map((del, idx) => (
                              <span key={idx} className="bg-danger/10 text-danger border border-danger/15 text-[10px] px-2 py-0.5 rounded font-mono font-bold">
                                ✕ {del}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-[color:var(--border-subtle)] pt-3 space-y-1.5">
                          <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-1.5">💡 Actionable Recommendations</div>
                          {msg.coachingData.recommendations.map((rec, idx) => (
                            <div key={idx} className="flex items-start gap-1.5 text-xs text-t3 leading-normal">
                              <span className="text-accent mt-0.5">•</span>
                              <span>{rec}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : msg.isStoryCard && msg.storyData ? (
                      <div className="card bg-gradient-to-br from-card to-surface-raised/80 border border-[color:var(--border)] p-5 rounded-xl shadow-glow-prism space-y-4 w-full max-w-md">
                        <div className="border-b border-[color:var(--border-subtle)] pb-2.5">
                          <span className="text-[10px] uppercase tracking-wider text-accent font-bold">Story Summary</span>
                          <h4 className="font-display text-sm text-t1 font-bold">Narrative Canvas</h4>
                        </div>

                        <div className="space-y-3.5 text-xs">
                          <div>
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-0.5">World</div>
                            <p className="text-t2 leading-relaxed">{msg.storyData.world}</p>
                          </div>

                          <div className="border-t border-[color:var(--border-subtle)] pt-3">
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-2">Characters</div>
                            <div className="space-y-2">
                              {msg.storyData.characters.map((char, idx) => (
                                <div key={idx} className="p-2.5 bg-surface-inset border border-[color:var(--border-subtle)] rounded-lg">
                                  <div className="flex justify-between items-center mb-0.5">
                                    <span className="font-bold text-t1">{char.name}</span>
                                    <span className="text-[10px] font-bold text-accent uppercase tracking-wider">{char.role}</span>
                                  </div>
                                  <p className="text-[11px] text-t3 leading-normal">{char.desc}</p>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="border-t border-[color:var(--border-subtle)] pt-3">
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-0.5">Conflict</div>
                            <p className="text-t2 leading-relaxed">{msg.storyData.conflict}</p>
                          </div>

                          <div className="border-t border-[color:var(--border-subtle)] pt-3">
                            <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-0.5">Narrative</div>
                            <p className="text-t2 leading-relaxed">{msg.storyData.narrative}</p>
                          </div>

                          <div className="border-t border-[color:var(--border-subtle)] pt-3 grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-0.5">Dialogue Style</div>
                              <div className="text-t2 font-medium">{msg.storyData.dialogueStyle}</div>
                            </div>
                            <div>
                              <div className="text-t4 text-[10px] uppercase tracking-wider font-bold mb-0.5">Tone</div>
                              <div className="text-t2 font-medium">{msg.storyData.tone}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : msg.reasoningStep !== undefined ? (
                      <div className="card bg-surface-raised border border-[color:var(--border-subtle)] p-4 rounded-xl rounded-tl-none space-y-3 w-full max-w-sm">
                        <div className="flex items-center gap-2 font-display text-xs text-t1 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
                          <Brain className="w-4 h-4 text-accent" /> Foundry Production Assistant
                        </div>
                        <div className="text-[11px] font-mono text-t3 animate-pulse">
                          Analyzing project concept details...
                        </div>
                        
                        <div className="space-y-1 font-mono text-[11px]">
                          {[
                            "Understanding project",
                            "Identifying genre",
                            "Detecting creative roles",
                            "Estimating production scope",
                            "Building roadmap",
                            "Generating deliverables",
                            "Calculating creator rewards",
                            "Computing royalty splits",
                            "Preparing workspace"
                          ].map((stepLabel, idx) => {
                            const isDone = msg.reasoningStep! > idx;
                            const isActive = msg.reasoningStep! === idx;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <span className={isDone ? "text-success font-bold" : isActive ? "text-info font-bold" : "text-t4"}>
                                  {isDone ? "✓" : isActive ? "➔" : "○"}
                                </span>
                                <span className={isDone ? "text-t3 line-through" : isActive ? "text-t2 font-medium" : "text-t4"}>
                                  {stepLabel}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`p-3.5 rounded-xl text-[13px] leading-relaxed ${
                          isUser
                            ? "bg-accent text-on-accent rounded-tr-none font-medium"
                            : "bg-surface-raised border border-[color:var(--border-subtle)] text-t2 rounded-tl-none font-sans"
                        }`}
                      >
                        {isUser ? msg.text : <FormattedMarkdown text={msg.text} />}
                      </div>
                    )}
                    <span className="text-[10px] text-t4 mt-1 font-mono">{msg.timestamp}</span>
                  </div>
                );
              })}
              {sendingChat && (
                <div className="mr-auto items-start flex flex-col">
                  <span className="text-[11px] text-t4 font-semibold mb-1">Foundry Production Assistant</span>
                  <div className="bg-surface-raised border border-[color:var(--border-subtle)] p-3 rounded-xl rounded-tl-none text-xs text-t3 font-mono flex items-center gap-1.5">
                    <Spinner /> Foundry composing thoughts…
                  </div>
                </div>
              )}
              {pendingConcept && (
                <div className="w-full flex justify-center py-4">
                  <button
                    onClick={executePlanningFlow}
                    className="py-3 px-8 rounded-xl font-bold text-sm bg-gradient-to-r from-accent via-violet to-info text-t1 shadow-glow-prism transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2"
                  >
                    ⚡ Generate Production Plan
                  </button>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input & Presets */}
            <div className="p-3 bg-surface-raised border-t border-[color:var(--border-subtle)] space-y-2">
              
              {/* Presets — contextual to THIS project's description */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => handleSendChat(`Decompose: ${board?.work.description || board?.work.title || "this project's core concept"}`)}
                  className="bg-surface-inset hover:bg-[color:var(--surface-active)] text-[11px] px-2 py-1 rounded text-t3 border border-[color:var(--border)]"
                  disabled={sendingChat}
                >
                  <Target className="w-4 h-4 text-accent" /> Plan this project
                </button>
                <button
                  onClick={() => handleSendChat(`Generate a detailed backstory for "${board?.work.title ?? "the current project"}" based on its description.`)}
                  className="bg-surface-inset hover:bg-[color:var(--surface-active)] text-[11px] px-2 py-1 rounded text-t3 border border-[color:var(--border)]"
                  disabled={sendingChat}
                >
                  ✍️ Backstory Outlines
                </button>
                <button
                  onClick={() => handleSendChat(`Review the current workspace for "${board?.work.title ?? "the project"}" and give me proactive coaching: what's missing, what to do next.`)}
                  className="bg-surface-inset hover:bg-[color:var(--surface-active)] text-[11px] px-2 py-1 rounded text-t3 border border-[color:var(--border)]"
                  disabled={sendingChat}
                >
                  💡 Coaching Tip
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendChat()}
                  placeholder='Say: "Decompose: [Idea]" or ask general script/dialogue help...'
                  className="input flex-1 py-1.5 px-3 text-xs bg-surface text-t1 placeholder:text-t4/60 caret-accent"
                  style={{ color: 'var(--text-1)', caretColor: 'var(--accent)' }}
                  disabled={sendingChat}
                />
                <button
                  onClick={() => handleSendChat()}
                  className="btn-primary py-1 px-4 text-xs"
                  disabled={sendingChat || !chatInput.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          {/* Right Context Panel (Visual Planner & Brief) */}
          <div className="lg:col-span-2 xl:col-span-2 space-y-6">
            
            {/* Context: Inspiration Board & Memory */}
            {memory && (
              <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-gradient-to-br from-surface-raised to-surface overflow-hidden">
                <div className="px-5 py-4 border-b border-[color:var(--border-subtle)] flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-accent-subtle/20 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  </div>
                  <h3 className="text-xs font-bold text-t1 tracking-wide">Visual Memory Canvas</h3>
                </div>
                <div className="p-5 space-y-5">
                  {/* Colors */}
                  <div>
                    <span className="text-[11px] font-semibold text-t4 uppercase tracking-wider block mb-2.5">Brand Palette</span>
                    <div className="grid grid-cols-2 gap-2">
                      {memory.brandColors.map((c, i) => (
                        <div key={i} className="flex items-center gap-2.5 bg-surface-inset border border-[color:var(--border-subtle)] rounded-xl px-3 py-2.5">
                          <span className="w-7 h-7 rounded-lg border border-[color:var(--border)] shadow-inner" style={{ backgroundColor: c.hex }} />
                          <div className="min-w-0">
                            <span className="text-[11px] font-medium text-t2 block truncate">{c.name}</span>
                            <span className="text-[10px] font-mono text-t4">{c.hex}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Art Style */}
                  <div className="bg-surface-inset border border-[color:var(--border-subtle)] rounded-xl p-4 space-y-1.5">
                    <span className="text-[11px] font-semibold text-t4 uppercase tracking-wider flex items-center gap-1.5">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v4M12 22v-4M2 12h4M18 12h4"/></svg>
                      Art Style
                    </span>
                    <span className="text-sm font-medium text-t1 leading-snug block">{memory.artStyle}</span>
                  </div>
                  {/* Audio Tone */}
                  <div className="bg-surface-inset border border-[color:var(--border-subtle)] rounded-xl p-4 space-y-1.5">
                    <span className="text-[11px] font-semibold text-t4 uppercase tracking-wider flex items-center gap-1.5">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                      Audio Direction
                    </span>
                    <span className="text-sm font-medium text-t1 leading-snug block">{memory.musicProfile}</span>
                  </div>
                  {/* Characters */}
                  {memory.characters && memory.characters.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold text-t4 uppercase tracking-wider block">Characters</span>
                      {memory.characters.map((ch, i) => (
                        <div key={i} className="bg-surface-inset border border-[color:var(--border-subtle)] rounded-xl px-4 py-3">
                          <span className="text-xs font-semibold text-t1 block">{ch.name}</span>
                          <span className="text-[11px] text-t4 block mt-0.5">{ch.role}{ch.description ? ` — ${ch.description}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

        </div>

        {/* Full-width Roadmap Section */}
        {draftPlan && (
          <div className="mt-6 rounded-2xl border border-accent/20 bg-gradient-to-br from-surface-raised to-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-[color:var(--border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 22v-4M2 12h4M18 12h4"/><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/></svg>
                <h3 className="text-sm font-bold text-t1">Review Foundry's Roadmap</h3>
              </div>
              <span className="text-[11px] text-t4 bg-surface-inset px-2 py-1 rounded font-medium">Editable</span>
            </div>

            <div className="p-4 space-y-2">
              {draftPlan.suggestedBounties.map((b, idx) => (
                <div key={idx} className="bg-surface-inset border border-[color:var(--border-subtle)] rounded-lg px-3 py-2 flex items-center gap-3">
                  <input className="bg-transparent border-b border-transparent focus:border-accent text-xs font-bold text-t1 outline-none min-w-0 flex-1 pb-0.5 truncate" value={b.title} onChange={(e) => handleEditDraftBounty(idx, "title", e.target.value)} />
                  <Select value={b.role} onChange={(e) => handleEditDraftBounty(idx, "role", e.target.value)} className="bg-surface-inset border border-[color:var(--border)] rounded text-[11px] text-t2 px-1.5 py-0.5 w-auto max-w-[120px]">
                    {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
                  </Select>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[8px] text-t4">Ξ</span>
                    <input type="number" step="0.001" className="bg-surface-inset border border-[color:var(--border)] rounded px-1 py-0.5 text-[11px] text-t2 w-16 outline-none focus:border-accent/50" value={b.rewardEth} onChange={(e) => handleEditDraftBounty(idx, "rewardEth", e.target.value)} />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <input type="number" className="bg-surface-inset border border-[color:var(--border)] rounded px-1 py-0.5 text-[11px] text-t2 w-12 outline-none focus:border-accent/50" value={b.revenuePercent} onChange={(e) => handleEditDraftBounty(idx, "revenuePercent", e.target.value)} />
                    <span className="text-[10px] text-t4">%</span>
                  </div>
                  <button onClick={() => handleDeleteDraftBounty(idx)} className="text-[10px] text-danger/60 hover:text-danger shrink-0 ml-1">✕</button>
                </div>
              ))}
            </div>

            {populatingTasks ? (
              <div className="bg-surface-inset border-t border-accent/20 p-4 space-y-2 font-mono text-xs text-t2">
                <div className="flex items-center gap-2 font-bold text-t1 pb-1"><Spinner /> Generating Workspace...</div>
                {[{ label: "Creating deliverables...", step: 1 }, { label: "Building workspace...", step: 2 }, { label: "Synchronizing creative memory...", step: 3 }, { label: "Workspace ready", step: 4 }].map((item) => (
                  <div key={item.step} className="flex items-center gap-2">
                    <span className={populateStepIndex >= item.step ? "text-success" : populateStepIndex === item.step - 1 ? "text-accent" : "text-t4"}>{populateStepIndex >= item.step ? "✓" : populateStepIndex === item.step - 1 ? "➔" : "○"}</span>
                    <span className={populateStepIndex >= item.step ? "text-t3 line-through" : populateStepIndex === item.step - 1 ? "text-t2 font-medium" : "text-t4"}>{item.label}</span>
                  </div>
                ))}
              </div>
            ) : !planningAnimationComplete ? (
              <div className="bg-surface-inset border-t border-accent/20 p-4 text-center">
                <Bot className="w-5 h-5 text-accent mx-auto mb-2" />
                <p className="text-xs text-t4 font-mono animate-pulse">Foundry is composing production plan...</p>
              </div>
            ) : (
              <div className="p-4 border-t border-[color:var(--border-subtle)]">
                <button onClick={approveAndPopulate} className="w-full py-3 px-6 rounded-xl font-bold text-sm bg-gradient-to-r from-accent via-violet to-info text-t1 shadow-glow-prism transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2" disabled={draftPlan.suggestedBounties.length === 0}>
                  <Rocket className="w-4 h-4" /> Approve & Populate Workspace
                </button>
              </div>
            )}
          </div>
        )}
        </>
      )}

      {/* Manual Open Bounty Modal */}
      {isProducer && (
        <OpenBountyModal
          open={openBountyOpen}
          onClose={() => setOpenBountyOpen(false)}
          workId={work.id}
          onCreated={() => {
            setOpenBountyOpen(false);
            load();
          }}
          walletAddr={address!}
        />
      )}

      {/* Critic Review Modal */}
      {isProducer && reviewing && (
        <ReviewModal
          bounty={reviewing}
          assetContract={work.asset_contract}
          escrow={escrows[reviewing.id] ?? null}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            load();
          }}
          walletAddr={address!}
        />
      )}

      {/* Escrow: lock the reward before the work starts */}
      {isProducer && lockingBounty && (
        <EscrowLockModal
          bounty={lockingBounty}
          assetContract={work.asset_contract}
          onClose={() => setLockingBounty(null)}
          onDone={() => {
            setLockingBounty(null);
            load();
          }}
          walletAddr={address!}
        />
      )}

    </div>
  );
}

/** Live tick for the escrow SLA countdowns (only runs while a clock is open). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Producer-chosen SLA windows. The 5-minute option exists so the auto-release
 *  path can be demonstrated live; it is labelled as a demo window, not policy. */
const WINDOW_OPTIONS = [
  { label: "5 minutes (live demo)", value: 300 },
  { label: "1 hour", value: 3600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
];

/**
 * Lock a bounty reward in escrow — the step that turns a promise into a
 * guarantee. Signs up to three transactions: USDG approve, fund, and (when the
 * bounty is already claimed) the contributor assignment that starts the clocks.
 */
function EscrowLockModal({
  bounty,
  onClose,
  onDone,
  walletAddr,
}: {
  bounty: Bounty;
  assetContract: string | null;
  onClose: () => void;
  onDone: () => void;
  walletAddr: string;
}) {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deliveryWindow, setDeliveryWindow] = useState(DEFAULT_DELIVERY_WINDOW_SECONDS);
  const [reviewWindow, setReviewWindow] = useState(DEFAULT_REVIEW_WINDOW_SECONDS);
  const reward = Number(bounty.reward_eth) || 0;

  async function lockReward() {
    if (!publicClient) {
      setError("Wallet is still connecting — try again in a moment.");
      return;
    }
    if (reward <= 0) {
      setError("This bounty has no reward to lock.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStep("Hashing the brief…");
      const attest = await apiGet<{ briefHash: string }>(`/api/bounties/${bounty.id}/attest`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = ((args: any) => publicClient.readContract(args)) as EscrowReader;
      setStep(`Locking ${reward} USDG in escrow…`);
      const { fundTx } = await fundBountyEscrow(writeContractAsync, reader, {
        bountyId: bounty.id,
        amount: reward,
        briefHash: attest.briefHash as `0x${string}`,
        owner: walletAddr,
      });

      await apiPost(`/api/bounties/${bounty.id}/escrow`, {
        wallet: walletAddr,
        action: "fund",
        txHash: fundTx,
        briefHash: attest.briefHash,
        deliveryWindowSeconds: deliveryWindow,
        reviewWindowSeconds: reviewWindow,
      });

      // Already claimed? Name the contributor now so both clocks start here
      // rather than needing a second visit.
      if (bounty.claimed_by) {
        setStep("Starting the SLA clock…");
        const assignTx = await assignBountyContributor(writeContractAsync, {
          bountyId: bounty.id,
          contributor: bounty.claimed_by,
          deliveryWindowSeconds: deliveryWindow,
          reviewWindowSeconds: reviewWindow,
        });
        await apiPost(`/api/bounties/${bounty.id}/escrow`, {
          wallet: walletAddr,
          action: "assign",
          txHash: assignTx,
        });
      }

      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not lock the reward");
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Lock the reward in escrow">
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-t3">
          Locking moves <span className="font-semibold text-t1">{reward} USDG</span> into a
          contract that neither side can take back unilaterally. The contributor is paid when you
          approve — or automatically, on the review deadline below, if you never do.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-t4">
              Contributor delivery window
            </label>
            <Select
              value={String(deliveryWindow)}
              onChange={(e) => setDeliveryWindow(Number(e.target.value))}
              disabled={busy}
              className="w-full text-[13px] py-1.5"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[10px] leading-relaxed text-t4">
              Miss it with nothing delivered and you can reclaim the reward.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-t4">
              Your review window
            </label>
            <Select
              value={String(reviewWindow)}
              onChange={(e) => setReviewWindow(Number(e.target.value))}
              disabled={busy}
              className="w-full text-[13px] py-1.5"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[10px] leading-relaxed text-t4">
              Starts at delivery. After it, the contributor can pay themselves.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-[color:var(--border)] bg-surface-2/50 px-3 py-2">
          <p className="rf-data text-[11px] text-t4">
            Escrow {BOUNTY_ESCROW_ADDRESS ? shortHash(BOUNTY_ESCROW_ADDRESS, 6) : "not deployed"} · the
            brief hash is locked with the money, so the spec being paid for is fixed at funding time.
          </p>
        </div>

        {step && (
          <p className="text-[12px] text-t3">
            <Spinner /> {step}
          </p>
        )}
        {error && <p className="text-[13px] text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={lockReward} disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Confirming…
              </>
            ) : (
              `🔒 Lock ${reward} USDG`
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BountyRow({
  bounty,
  isProducer,
  escrow,
  walletAddr,
  onReview,
  onLock,
  onChanged,
}: {
  bounty: Bounty;
  isProducer: boolean;
  escrow: EscrowState | null;
  walletAddr: string;
  onReview: () => void;
  onLock: () => void;
  onChanged: () => void;
}) {
  const b = bounty;
  const { writeContractAsync } = useWriteContract();
  const [escrowBusy, setEscrowBusy] = useState<null | "assign" | "auto" | "refund">(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  const locked = !!escrow && escrow.amount > 0n && !escrow.released;
  const now = useNow(locked);
  const assigned = !!escrow?.contributor && escrow.contributor !== "0x0000000000000000000000000000000000000000";

  /** Producer only: name the contributor on-chain, which starts the delivery clock. */
  async function startClock() {
    if (!assigned && !b.claimed_by) {
      setEscrowError("Nobody has claimed this bounty yet.");
      return;
    }
    setEscrowBusy("assign");
    setEscrowError(null);
    try {
      const tx = await assignBountyContributor(writeContractAsync, {
        bountyId: b.id,
        contributor: b.claimed_by!,
        deliveryWindowSeconds: b.delivery_window_seconds ?? DEFAULT_DELIVERY_WINDOW_SECONDS,
        reviewWindowSeconds: b.review_window_seconds ?? DEFAULT_REVIEW_WINDOW_SECONDS,
      });
      await apiPost(`/api/bounties/${b.id}/escrow`, {
        wallet: walletAddr,
        action: "assign",
        txHash: tx,
      }).catch(() => undefined);
      onChanged();
    } catch (e) {
      setEscrowError(e instanceof Error ? e.message : "Could not start the clock");
    } finally {
      setEscrowBusy(null);
    }
  }

  /**
   * The producer's half of the SLA: the delivery window closed with nothing
   * attested, so the reward comes back. Only reachable while no delivery was
   * ever recorded — a producer cannot claw back work that was handed in.
   */
  async function refundReward() {
    setEscrowBusy("refund");
    setEscrowError(null);
    try {
      const tx = await refundBountyEscrow(writeContractAsync, { bountyId: b.id });
      await apiPost(`/api/bounties/${b.id}/escrow`, {
        wallet: walletAddr,
        action: "refund",
        txHash: tx,
      }).catch(() => undefined);
      onChanged();
    } catch (e) {
      setEscrowError(e instanceof Error ? e.message : "Could not reclaim the reward");
    } finally {
      setEscrowBusy(null);
    }
  }

  /**
   * Permissionless SLA backstop. Once the review window has closed with no
   * producer signature, this pays the contributor — which is the entire point
   * of escrow: the artist never depends on the producer showing up.
   */
  async function claimViaSla() {
    setEscrowBusy("auto");
    setEscrowError(null);
    try {
      const tx = await autoReleaseBountyEscrow(writeContractAsync, { bountyId: b.id });
      // Permissionless on purpose — the route records the tx without an owner check.
      await apiPost(`/api/bounties/${b.id}/escrow`, {
        wallet: walletAddr || undefined,
        action: "auto",
        txHash: tx,
      }).catch(() => undefined);
      onChanged();
    } catch (e) {
      setEscrowError(e instanceof Error ? e.message : "Could not release via SLA");
    } finally {
      setEscrowBusy(null);
    }
  }
  const hasAsset =
    (b.status === "delivered" || b.status === "approved" || b.status === "minted") &&
    !!b.delivery_path;

  // "concept_artist" → "Concept Artist" for display (data keeps the canonical slug)
  const roleLabel = (b.role || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const brief = b.instructions
    ? b.instructions.length > 120
      ? `${b.instructions.slice(0, 120).trimEnd()}…`
      : b.instructions
    : null;

  const statusLabel = b.status === "open" ? "Open" :
    b.status === "claimed" ? "Claimed" :
    b.status === "delivered" ? "Under Review" :
    b.status === "approved" ? "Approved" : "Published";

  const statusBorder =
    b.status === "claimed" ? "border-l-info" :
    b.status === "delivered" ? "border-l-warning" :
    b.status === "approved" ? "border-l-accent" :
    b.status === "minted" ? "border-l-verified" : "border-l-[color:var(--border)]";

  return (
    <article
      className={`card border-l-[3px] p-4 transition-all sm:p-5 hover:border-[color:var(--border-strong)] hover:shadow-glow-card ${statusBorder}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          {hasAsset && (
            <div className="shrink-0">
              <AssetThumb path={b.delivery_path!} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="text-[15px] font-semibold leading-snug text-t1">{b.title}</h3>
              <span className={`pill px-2 py-0 text-[11px] font-semibold uppercase tracking-wider ${
                b.status === "minted" ? "border-verified/25 bg-verified-subtle text-verified" :
                b.status === "delivered" ? "border-warning/25 bg-warning-subtle text-warning" :
                b.status === "claimed" || b.status === "approved" ? "border-info/25 bg-info-subtle text-info" : ""
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  b.status === "minted" ? "bg-verified" :
                  b.status === "delivered" ? "bg-warning" :
                  b.status === "claimed" || b.status === "approved" ? "bg-info" : "bg-t4"
                }`} />
                {statusLabel}
              </span>
            </div>

            {brief && (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-t3">{brief}</p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="pill border-info/25 bg-info-subtle text-[11px] font-semibold text-info">
                {roleLabel}
              </span>
              <span className="pill rf-data text-[12px] text-t2">{b.reward_eth} USDG</span>
              {b.revenue_percent != null && (
                <span
                  className="pill border-accent-border bg-accent-subtle text-[12px] font-semibold text-t1"
                  title="This contributor's permanent share of every future sale — paid by the smart contract"
                >
                  {b.revenue_percent}% royalty
                </span>
              )}
              {b.claimed_by && (
                <span className="rf-data text-[11px] text-t4">{truncateAddress(b.claimed_by)}</span>
              )}
            </div>

            {/* Escrow strip — "is the reward locked, or just promised?"
                Reads live contract state, so it can't overstate what's secured. */}
            {ESCROW_ENABLED && (locked || escrow?.released || (isProducer && !locked)) && (
              <div className="mt-3 rounded-lg border border-[color:var(--border)] bg-surface-2/50 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Lock
                    className={`h-3.5 w-3.5 shrink-0 ${locked ? "text-verified" : "text-t4"}`}
                  />

                  {escrow?.refunded ? (
                    <span className="rf-data text-[11px] text-warning">
                      {formatUsdg(escrow.amount)} USDG returned — nothing was delivered in time
                    </span>
                  ) : escrow?.released ? (
                    <span className="rf-data text-[11px] text-verified">
                      {formatUsdg(escrow.amount)} USDG released to contributor
                      {b.escrow_release_kind === "auto" ? " (SLA auto-release)" : ""}
                    </span>
                  ) : locked ? (
                    <>
                      <span className="rf-data text-[11px] text-t2">
                        {formatUsdg(escrow!.amount)} USDG locked in escrow
                      </span>
                      {assigned ? (
                        escrow!.attested ? (
                          <span
                            className={`pill px-2 py-0 text-[10px] font-semibold uppercase tracking-wider ${
                              escrow!.releasable
                                ? "border-verified/25 bg-verified-subtle text-verified"
                                : "border-warning/25 bg-warning-subtle text-warning"
                            }`}
                            title="If the producer never reviews, this deadline hands the money to the contributor — without the producer's signature."
                          >
                            {escrow!.releasable
                              ? "SLA open · claimable"
                              : `Review window ${formatCountdown(escrow!.reviewDeadline - now)}`}
                          </span>
                        ) : (
                          <span
                            className="pill border-info/25 bg-info-subtle px-2 py-0 text-[10px] font-semibold uppercase tracking-wider text-info"
                            title="If the contributor never delivers, this deadline lets the producer reclaim the reward."
                          >
                            Delivery window {formatCountdown(escrow!.deliveryDeadline - now)}
                          </span>
                        )
                      ) : (
                        <span className="text-[11px] text-t4">awaiting contributor</span>
                      )}
                    </>
                  ) : (
                    <span className="text-[11px] text-t4">
                      Reward is not locked yet — the contributor has no guarantee.
                    </span>
                  )}

                  {escrowBusy ? (
                    <span className="text-[11px] text-t3">
                      <Spinner />{" "}
                      {escrowBusy === "assign"
                        ? "Starting clock…"
                        : escrowBusy === "refund"
                          ? "Reclaiming…"
                          : "Releasing…"}
                    </span>
                  ) : (
                    <>
                      {locked && !assigned && b.claimed_by && isProducer && (
                        <button
                          className="btn-ghost px-2.5 py-1 text-[11px] font-semibold text-info"
                          onClick={startClock}
                        >
                          Start SLA clock
                        </button>
                      )}
                      {locked && escrow!.releasable && (
                        <button
                          className="btn-ghost px-2.5 py-1 text-[11px] font-semibold text-verified"
                          onClick={claimViaSla}
                          title="Permissionless: anyone can trigger this once the review window closes."
                        >
                          Release via SLA
                        </button>
                      )}
                      {locked &&
                        assigned &&
                        !escrow!.attested &&
                        isProducer &&
                        now > escrow!.deliveryDeadline && (
                          <button
                            className="btn-ghost px-2.5 py-1 text-[11px] font-semibold text-warning"
                            onClick={refundReward}
                            title="The delivery window closed with nothing delivered — reclaim the reward."
                          >
                            Reclaim reward
                          </button>
                        )}
                    </>
                  )}
                </div>
                {escrowError && <p className="mt-1 text-[11px] text-danger">{escrowError}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          {isProducer && !locked && ESCROW_ENABLED && b.status !== "minted" && (
            <button
              className="btn-ghost mr-2 px-3 py-1.5 text-[12px] font-semibold text-verified whitespace-nowrap"
              onClick={onLock}
              title="Lock the reward in escrow before the work starts — the contributor is then guaranteed to be paid."
            >
              🔒 Lock reward
            </button>
          )}
          {b.status === "delivered" && isProducer && (
            <button
              className="btn-primary px-4 py-1.5 text-[13px] font-semibold whitespace-nowrap"
              onClick={onReview}
            >
              Review Deliverable
            </button>
          )}
          {b.status === "minted" && b.tx_hash && (
            <TxLink hash={b.tx_hash}>View Ownership Record</TxLink>
          )}
        </div>
      </div>
    </article>
  );
}

function OpenBountyModal({
  open,
  onClose,
  workId,
  onCreated,
  walletAddr,
}: {
  open: boolean;
  onClose: () => void;
  workId: string;
  onCreated: () => void;
  walletAddr: string;
}) {
  const [title, setTitle] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [rewardEth, setRewardEth] = useState("0.001");
  const [revenuePercent, setRevenuePercent] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deliverableSpecs, setDeliverableSpecs] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let referencePath: string | undefined;
      if (referenceFile) {
        referencePath = (await apiUpload(referenceFile)).path;
      }
      await apiPost(`/api/works/${workId}`, { // accepts slug or UUID
        title: title.trim(),
        role,
        rewardEth: Number(rewardEth),
        revenuePercent: revenuePercent === "" ? undefined : Number(revenuePercent),
        instructions: instructions.trim() || undefined,
        deliverableSpecs: deliverableSpecs.trim() || undefined,
        referencePath,
        wallet: walletAddr,
      });
      setTitle("");
      setRevenuePercent("");
      setInstructions("");
      setDeliverableSpecs("");
      setReferenceFile(null);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open bounty");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Open bounty">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="b-title">Title</label>
          <input
            id="b-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Concept art — protagonist"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="b-role">Role</label>
            <Select
              id="b-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={submitting}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="b-reward">Contributor Reward (USDG)</label>
            <input
              id="b-reward"
              className="input"
              type="number"
              step="0.0001"
              min="0"
              value={rewardEth}
              onChange={(e) => setRewardEth(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="b-pct">
            Revenue share <span className="font-normal">(% of work, optional)</span>
          </label>
          <input
            id="b-pct"
            className="input"
            type="number"
            min="0"
            max="100"
            value={revenuePercent}
            onChange={(e) => setRevenuePercent(e.target.value)}
            placeholder="e.g. 5"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label" htmlFor="b-instr">
            Instructions <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="b-instr"
            className="input min-h-[70px] resize-y"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should the artist make? Style, references, scope…"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label" htmlFor="b-specs">
            Deliverable specs <span className="font-normal">(optional)</span>
          </label>
          <textarea
            id="b-specs"
            className="input min-h-[60px] resize-y"
            value={deliverableSpecs}
            onChange={(e) => setDeliverableSpecs(e.target.value)}
            placeholder="e.g. 2048px PNG, transparent bg · or FBX, < 50k tris, PBR"
            disabled={submitting}
          />
        </div>

        <div>
          <label className="label">
            Reference file <span className="font-normal">(optional)</span>
          </label>
          <FileInput
            accept="*"
            disabled={submitting}
            onChange={setReferenceFile}
            label="Choose reference"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting || !title.trim()}>
            {submitting ? <><Spinner /> Opening…</> : "Open bounty"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({
  bounty,
  assetContract,
  escrow,
  onClose,
  onDone,
  walletAddr,
}: {
  bounty: Bounty;
  assetContract: string | null;
  escrow: EscrowState | null;
  onClose: () => void;
  onDone: () => void;
  walletAddr: string;
}) {
  const [busy, setBusy] = useState<null | "approve" | "changes" | "analyzing">(null);
  const [error, setError] = useState<string | null>(null);
  const [criticReport, setCriticReport] = useState<CriticReport | null>(null);
  const [criticStep, setCriticStep] = useState<number>(-1);
  const [showRevisionPanel, setShowRevisionPanel] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [revisionRefFile, setRevisionRefFile] = useState<File | null>(null);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const mediaUrl = servedUrl(bounty.delivery_path);
  const assetUrl = servedUrl(bounty.delivery_ipfs) ?? mediaUrl;
  const assetIsImage = isImagePath(bounty.delivery_ipfs ?? bounty.delivery_path);

  // Run Critic Check — calls the REAL backend orchestrator, which routes to the
  // trained Python CLIP critic (localhost:8787) and falls back to simulation
  // only if the service is unreachable.
  async function runCriticCheck() {
    setBusy("analyzing");
    setError(null);
    try {
      setCriticStep(0);
      const data = await apiPost<{ report: CriticReport }>("/api/ai/critic", {
        bountyId: bounty.id,
        deliveryPath: bounty.delivery_path,
        wallet: walletAddr,
      });
      setCriticStep(4);
      setCriticReport(data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Critic analysis failed");
    } finally {
      setBusy(null);
      setCriticStep(-1);
    }
  }

  async function approve() {
    if (busy) return;
    setBusy("approve");
    setError(null);
    try {
      let txHash: string | undefined;
      let tokenId: string | undefined;
      let payHash: string | undefined; // direct-transfer fallback
      let releaseHash: string | undefined; // escrow release
      let releaseKind: string | undefined;
      let briefHash: string | undefined;
      let deliveryHash: string | undefined;

      // Real wallet minting — only if a contract address is configured.
      // The contributor is the ERC-2981 royalty receiver (10% resale royalty).
      if (NFT_CONTRACT_ADDRESS && NFT_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
        const uri = `${window.location.origin}/api/metadata/${bounty.id}`;
        const hash = await writeContractAsync({
          address: NFT_CONTRACT_ADDRESS,
          abi: NFT_ABI,
          functionName: "mint",
          args: [
            bounty.claimed_by as `0x${string}`,
            uri,
            bounty.claimed_by as `0x${string}`,
            1000n,
          ],
        });
        txHash = hash;

        // Read the REAL token id out of the AssetMinted event in the receipt.
        // The mint call returns nothing and the contract's ids start at 0, so
        // guessing here produced broken token ids and dead NFT links.
        try {
          const receipt = await publicClient!.waitForTransactionReceipt({ hash });
          const mintLog = receipt.logs.find((l) => l.topics[0] === ASSET_MINTED_TOPIC);
          if (mintLog?.topics[1]) tokenId = BigInt(mintLog.topics[1]).toString();
        } catch (receiptErr) {
          console.warn("Could not read the token id from the mint receipt:", receiptErr);
        }
      }

      // Money. Two paths, in order of preference:
      //   1. escrow release — the reward was already locked before the work
      //      started, so this is a transfer of money that was never the
      //      producer's to withhold. Carries the critic score + both hashes.
      //   2. direct transfer — fallback for deployments with no escrow.
      const reward = Number(bounty.reward_eth) || 0;
      const escrowLocked = !!escrow && escrow.amount > 0n && !escrow.released;
      const escrowAssigned =
        !!escrow?.contributor &&
        escrow.contributor !== "0x0000000000000000000000000000000000000000";

      if (reward > 0 && bounty.claimed_by) {
        try {
          if (escrowLocked && ESCROW_ENABLED) {
            const attest = await apiGet<{ briefHash?: string; deliveryHash?: string }>(
              `/api/bounties/${bounty.id}/attest`
            ).catch(() => ({}) as { briefHash?: string; deliveryHash?: string });
            briefHash = attest.briefHash;
            deliveryHash = attest.deliveryHash;

            // release() reverts unless the contributor was assigned on-chain.
            // Push that assignment here so approval can never dead-end.
            if (!escrowAssigned) {
              await assignBountyContributor(writeContractAsync, {
                bountyId: bounty.id,
                contributor: bounty.claimed_by,
                deliveryWindowSeconds:
                  bounty.delivery_window_seconds ?? DEFAULT_DELIVERY_WINDOW_SECONDS,
                reviewWindowSeconds:
                  bounty.review_window_seconds ?? DEFAULT_REVIEW_WINDOW_SECONDS,
              });
            }

            releaseHash = await releaseBountyEscrow(writeContractAsync, {
              bountyId: bounty.id,
              criticScore: criticReport?.score ?? 0,
            });
            releaseKind = "release";
          } else {
            payHash = await payBountyInUsdg(writeContractAsync, {
              contributor: bounty.claimed_by,
              amount: reward,
            });
          }
        } catch (payErr) {
          console.warn("USDG payment failed (mint already recorded):", payErr);
          setError(
            escrowLocked
              ? "NFT minted, but the escrow release needs a signature. You can retry it from the task row."
              : "NFT minted, but the USDG payment needs a signature. You can retry payment from the task row."
          );
        }
      }

      await apiPost(`/api/bounties/${bounty.id}/approve`, {
        assetContract: assetContract || NFT_CONTRACT_ADDRESS || "deferred",
        wallet: walletAddr,
        txHash: txHash || undefined,
        tokenId: tokenId || undefined,
        paymentTxHash: payHash || undefined,
        escrowReleaseTx: releaseHash || undefined,
        escrowReleaseKind: releaseKind || undefined,
        escrowReleaseScore: criticReport?.score,
        briefHash: briefHash || undefined,
        deliveryHash: deliveryHash || undefined,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
      setBusy(null);
    }
  }

  async function requestChanges() {
    if (busy) return;
    if (!showRevisionPanel) {
      setShowRevisionPanel(true);
      return;
    }
    setBusy("changes");
    setError(null);
    try {
      let refImagePath: string | undefined;
      if (revisionRefFile) {
        const uploaded = await apiUpload(revisionRefFile);
        refImagePath = uploaded.path;
      }
      const revision: Record<string, string> = {};
      if (revisionFeedback.trim()) revision.feedback = revisionFeedback.trim();
      if (refImagePath) revision.refImagePath = refImagePath;

      await apiPost(`/api/bounties/${bounty.id}/approve`, {
        action: "request_changes",
        wallet: walletAddr,
        revision,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request changes failed");
      setBusy(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Submission Review">
      <div className="space-y-4">
        <AssetPreview path={bounty.delivery_path} alt={bounty.title} className="h-48 w-full rounded-xl" />

        <dl className="space-y-1 text-xs">
          <Row k="Title" v={bounty.title} />
          <Row k="Role" v={bounty.role} />
          <Row k="Creator Address" v={truncateAddress(bounty.claimed_by)} mono />
          {!assetIsImage && bounty.delivery_ipfs && (
            <Row k="Asset Type" v={fileTypeLabel(bounty.delivery_ipfs)} mono />
          )}
        </dl>

        {assetUrl && (
          <a
            href={assetUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs font-semibold text-info hover:underline"
          >
            ↓ Download raw asset
          </a>
        )}

        {/* AI Critic Action & Result Display */}
        <div className="border border-[color:var(--border-subtle)] bg-surface-inset p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-bold text-t3 tracking-wider flex items-center gap-1">
              <Bot className="w-4 h-4 text-accent" /> Foundry Intelligence Creative Critic
            </span>
            {criticReport && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                criticReport.score >= 90 ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
              }`}>
                Score: {criticReport.score}%
              </span>
            )}
          </div>

          {busy === "analyzing" && criticStep >= 0 ? (
            <div className="font-mono text-[11px] space-y-1.5 p-3 bg-surface rounded border border-[color:var(--border-subtle)] text-t2">
              <div className="flex items-center gap-2 font-bold text-t1 mb-1">
                <Spinner /> Foundry Intelligence Critic Auditing...
              </div>
              <div className="flex items-center gap-2">
                <span className={criticStep >= 1 ? "text-success font-bold" : "text-info font-bold"}>
                  {criticStep >= 1 ? "✓" : "➔"}
                </span>
                <span className={criticStep >= 1 ? "text-t3 line-through" : "text-t2"}>
                  Checking visual style...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={criticStep >= 2 ? "text-success font-bold" : criticStep === 1 ? "text-info font-bold" : "text-t4"}>
                  {criticStep >= 2 ? "✓" : criticStep === 1 ? "➔" : "○"}
                </span>
                <span className={criticStep >= 2 ? "text-t3 line-through" : criticStep === 1 ? "text-t2 font-medium" : "text-t4"}>
                  Checking palette...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={criticStep >= 3 ? "text-success font-bold" : criticStep === 2 ? "text-info font-bold" : "text-t4"}>
                  {criticStep >= 3 ? "✓" : criticStep === 2 ? "➔" : "○"}
                </span>
                <span className={criticStep >= 3 ? "text-t3 line-through" : criticStep === 2 ? "text-t2 font-medium" : "text-t4"}>
                  Checking proportions...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={criticStep >= 4 ? "text-success font-bold" : criticStep === 3 ? "text-info font-bold" : "text-t4"}>
                  {criticStep >= 4 ? "✓" : criticStep === 3 ? "➔" : "○"}
                </span>
                <span className={criticStep >= 4 ? "text-t3 line-through" : criticStep === 3 ? "text-t2 font-medium" : "text-t4"}>
                  Checking branding...
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={criticStep >= 5 ? "text-success font-bold" : criticStep === 4 ? "text-info font-bold" : "text-t4"}>
                  {criticStep >= 5 ? "✓" : criticStep === 4 ? "➔" : "○"}
                </span>
                <span className={criticStep >= 5 ? "text-t3 line-through" : criticStep === 4 ? "text-t2 font-medium" : "text-t4"}>
                  Checking completeness...
                </span>
              </div>
            </div>
          ) : !criticReport ? (
            <button
              onClick={runCriticCheck}
              disabled={busy === "analyzing"}
              className="btn-ghost w-full py-1 text-xs font-semibold bg-surface-inset border border-[color:var(--border)] hover:bg-[color:var(--surface-active)]"
            >
              Run Foundry Intelligence Creative Critic
            </button>
          ) : (
            <div className="space-y-3 text-xs leading-relaxed text-t2">
              {/* Checklist states */}
              <div className="flex flex-wrap gap-3">
                <CheckLabel label="Style Match" passed={criticReport.checks.styleConsistency} />
                <CheckLabel label="Palette Match" passed={criticReport.checks.colorMatch} />
                <CheckLabel label="Composition" passed={criticReport.checks.proportionsMatch} />
                <CheckLabel label="Requirements Complete" passed={!criticReport.checks.duplicateRisk} />
              </div>
              <p className="font-mono bg-surface p-3 rounded text-[11px] whitespace-pre-wrap">
                {criticReport.feedback}
              </p>
              <div className="text-[11px] text-t4">
                *Critic compared submission metadata and visual ratios against persistent project Memory Canvas constraints.
              </div>
            </div>
          )}
        </div>

        {busy === "approve" ? (
          <TxPending
            title="Registering approved asset..."
            steps={["Updating attribution status in database"]}
          />
        ) : (
          <>
            <div className="rounded-md border border-[color:var(--border-subtle)] bg-surface-raised p-3 text-[11px] text-t3">
              Approving records the asset's author. Digital ownership and royalty distribution will be registered on-chain during publishing.
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            {showRevisionPanel && (
              <div className="space-y-3 border border-warning/20 bg-warning/[0.03] rounded-xl p-4">
                <span className="text-[11px] font-bold text-warning uppercase tracking-wider flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                  Revision Notes
                </span>
                <textarea
                  value={revisionFeedback}
                  onChange={(e) => setRevisionFeedback(e.target.value)}
                  placeholder="Describe what needs to change — be specific about style, composition, color, or any missing elements..."
                  rows={3}
                  className="w-full bg-surface-inset border border-[color:var(--border)] rounded-lg px-3 py-2 text-xs text-t2 outline-none focus:border-accent/50 resize-none placeholder:text-t4/60"
                />
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer bg-surface-inset border border-[color:var(--border)] rounded-lg px-3 py-2 hover:bg-[color:var(--surface-active)]">
                    <svg className="w-4 h-4 text-t4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    <span className="text-xs text-t3">{revisionRefFile ? revisionRefFile.name : "Add reference image"}</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setRevisionRefFile(f);
                    }} />
                  </label>
                  {revisionRefFile && (
                    <button onClick={() => setRevisionRefFile(null)} className="text-[11px] text-danger/70 hover:text-danger">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="sticky bottom-0 bg-surface pt-3 pb-1 flex justify-end gap-2 border-t border-[color:var(--border-subtle)] mt-4 -mx-6 px-6">
              <button className="btn-ghost" onClick={requestChanges} disabled={busy !== null}>
                {busy === "changes" ? <><Spinner /> …</> : showRevisionPanel ? "Confirm Revision" : "Return for Revision"}
              </button>
              <button className="btn-primary" onClick={approve} disabled={busy !== null}>
                Approve &amp; Publish
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function CheckLabel({ label, passed }: { label: string; passed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-semibold ${
      passed ? "text-success bg-success-subtle" : "text-danger bg-danger-subtle"
    }`}>
      <span>{passed ? "✓" : "✗"}</span> {label}
    </span>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-t3">{k}</dt>
      <dd className={mono ? "rf-data text-t1" : "text-t1"}>{v}</dd>
    </div>
  );
}

function ActivityEvent({
  icon: Icon,
  title,
  desc,
  time,
  active,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  time: string;
  active?: boolean;
}) {
  return (
    <div className="relative pl-8 text-sm">
      {Icon && (
        <span className="absolute left-0 top-0 w-6 h-6 flex items-center justify-center rounded-full bg-surface-inset border border-[color:var(--border-subtle)]">
          <Icon className="w-3 h-3 text-t3" />
        </span>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <span className={`font-semibold text-[13px] leading-snug ${active ? "text-t1" : "text-t3"}`}>{title}</span>
        <span className="text-[11px] text-t4 font-mono whitespace-nowrap shrink-0">{time}</span>
      </div>
      <span className="text-t4 block mt-0.5 text-xs leading-relaxed">{desc}</span>
    </div>
  );
}

function BountyDeliveryModal({
  bounty,
  wallet,
  onClose,
  onDone,
}: {
  bounty: Bounty;
  wallet: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [asset, setAsset] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [step, setStep] = useState<null | "uploading" | "saving">(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  const assetIsImage = asset?.type.startsWith("image/") ?? false;
  const needsPreview = !!asset && !assetIsImage;
  const canSubmit = !!asset && (assetIsImage || !!preview);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!asset || busy) return;
    if (needsPreview && !preview) {
      setError("This asset isn't an image — add a preview image for the NFT media.");
      return;
    }
    setError(null);
    try {
      setStep("uploading");
      const assetRes = await apiUpload(asset);
      let deliveryPath = assetRes.path;
      let deliveryIpfs: string | undefined = assetRes.url;
      if (!assetRes.isImage) {
        const previewRes = await apiUpload(preview!);
        deliveryPath = previewRes.path;
        deliveryIpfs = assetRes.url;
      }
      setStep("saving");
      await apiPost(`/api/bounties/${bounty.id}/deliver`, {
        wallet,
        deliveryPath,
        deliveryIpfs,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delivery failed");
      setStep(null);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Deliver task asset">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-t3 leading-relaxed">
          Deliver the final file (image, 3D, audio, code). It will be registered on Arbitrum upon producer review approval.
        </p>

        {(bounty.instructions || bounty.deliverable_specs || bounty.reference_path) && (
          <div className="space-y-3 rounded-xl border border-[color:var(--border-subtle)] bg-surface-raised p-4 text-xs">
            {bounty.instructions && (
              <div>
                <div className="text-[11px] uppercase font-bold text-t4 tracking-wider mb-1">Production Brief Instructions</div>
                <p className="whitespace-pre-wrap text-t2 leading-relaxed">{bounty.instructions}</p>
              </div>
            )}
            {bounty.deliverable_specs && (
              <div>
                <div className="text-[11px] uppercase font-bold text-t4 tracking-wider mb-1">Technical Specs</div>
                <p className="whitespace-pre-wrap text-t2 leading-relaxed">{bounty.deliverable_specs}</p>
              </div>
            )}
            {bounty.reference_path && servedUrl(bounty.reference_path) && (
              <a
                href={servedUrl(bounty.reference_path)!}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs font-semibold text-info hover:underline"
              >
                ↓ Download project reference asset
              </a>
            )}
            {(bounty.revision_feedback || bounty.revision_ref_image) && (
              <div className="border-t border-warning/20 pt-3 mt-3">
                <span className="text-[11px] font-bold text-warning uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/></svg>
                  Revision Requested
                </span>
                {bounty.revision_feedback && (
                  <p className="text-xs text-t2 whitespace-pre-wrap leading-relaxed bg-warning/[0.04] rounded-lg p-3 border border-warning/10">{bounty.revision_feedback}</p>
                )}
                {bounty.revision_ref_image && servedUrl(bounty.revision_ref_image) && (
                  <a
                    href={servedUrl(bounty.revision_ref_image)!}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-info hover:underline"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                    View reference image from director
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[11px] uppercase font-bold text-t4 tracking-wider">Deliverable File</label>
          <FileInput accept="*" disabled={busy} onChange={setAsset} label="Choose asset file" />
        </div>

        {needsPreview && (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-surface-raised p-4 space-y-2">
            <p className="text-[11px] text-t3 leading-relaxed">
              <span className="font-mono text-t2 font-semibold">{asset?.name}</span> is not a direct image. 
              Upload a preview image to represent this asset in the NFT gallery.
            </p>
            <FileInput
              accept="image/*"
              disabled={busy}
              onChange={setPreview}
              label="Choose preview image"
            />
          </div>
        )}

        {error && <p className="text-xs text-danger font-semibold">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
            {step === "uploading" ? (
              <><Spinner /> Uploading…</>
            ) : step === "saving" ? (
              <><Spinner /> Registering…</>
            ) : (
              "Submit Delivery"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Custom Premium inline Markdown Parser Component for Foundry Intelligence Assistant
function FormattedMarkdown({ text }: { text: string }) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string | number) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key}`} className="list-disc pl-5 my-2 space-y-1 text-t3 text-xs">
          {listItems.map((item, idx) => (
            <li key={idx} className="marker:text-accent">{item}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("```")) {
      flushList(i);
      const codeLines = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("```")) {
        codeLines.push(lines[j]);
        j++;
      }
      i = j;
      elements.push(
        <pre key={`code-${i}`} className="bg-surface border border-[color:var(--border-subtle)] p-3 rounded-lg overflow-x-auto my-3 text-[11px] font-mono text-info">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (line.startsWith("###")) {
      flushList(i);
      elements.push(
        <h4 key={`h4-${i}`} className="font-display font-bold text-t1 text-xs mt-3 mb-1 uppercase tracking-wider">
          {parseInline(line.replace("###", "").trim())}
        </h4>
      );
      continue;
    }
    if (line.startsWith("##")) {
      flushList(i);
      elements.push(
        <h3 key={`h3-${i}`} className="font-display font-bold text-t1 text-sm mt-4 mb-1.5 border-b border-[color:var(--border-subtle)] pb-1">
          {parseInline(line.replace("##", "").trim())}
        </h3>
      );
      continue;
    }
    if (line.startsWith("#")) {
      flushList(i);
      elements.push(
        <h2 key={`h2-${i}`} className="font-display font-bold text-t1 text-base mt-4 mb-2 bg-gradient-to-r from-t1 to-t3 bg-clip-text text-transparent">
          {parseInline(line.replace("#", "").trim())}
        </h2>
      );
      continue;
    }

    if (line.startsWith(">")) {
      flushList(i);
      elements.push(
        <blockquote key={`bq-${i}`} className="border-l-2 border-accent/60 pl-3 py-1 my-2 italic text-t3 text-xs bg-surface-inset rounded-r">
          {parseInline(line.replace(">", "").trim())}
        </blockquote>
      );
      continue;
    }

    if (line.startsWith("-") || line.startsWith("*")) {
      listItems.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (line === "") {
      flushList(i);
      continue;
    }

    flushList(i);
    elements.push(
      <p key={`p-${i}`} className="my-1.5 text-t2 leading-relaxed text-xs">
        {parseInline(line)}
      </p>
    );
  }

  flushList("final");

  return <div className="space-y-1">{elements}</div>;
}

function parseInline(text: string): React.ReactNode[] {
  const parts = [];
  let remaining = text;
  let idx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    const italicMatch = remaining.match(/\*(.*?)\*/);

    let match = null;
    let type: "bold" | "italic" | null = null;

    if (boldMatch && italicMatch) {
      if (boldMatch.index! < italicMatch.index!) {
        match = boldMatch;
        type = "bold";
      } else {
        match = italicMatch;
        type = "italic";
      }
    } else if (boldMatch) {
      match = boldMatch;
      type = "bold";
    } else if (italicMatch) {
      match = italicMatch;
      type = "italic";
    }

    if (!match) {
      parts.push(<span key={idx++}>{remaining}</span>);
      break;
    }

    const textBefore = remaining.substring(0, match.index);
    if (textBefore) {
      parts.push(<span key={idx++}>{textBefore}</span>);
    }

    const matchedText = match[1];
    if (type === "bold") {
      parts.push(<strong key={idx++} className="font-bold text-t1">{matchedText}</strong>);
    } else if (type === "italic") {
      parts.push(<em key={idx++} className="italic text-t1">{matchedText}</em>);
    }

    remaining = remaining.substring(match.index! + match[0].length);
  }

  return parts;
}

