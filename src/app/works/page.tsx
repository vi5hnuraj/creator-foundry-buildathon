"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Work } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api";
import { useIdentity } from "@/lib/use-identity";
import { RequireWallet } from "@/components/require-wallet";
import { HeroStat, SectionHead, EmptyState } from "@/components/editorial";
import { WorkStatusPill } from "@/components/status-pill";
import { Modal } from "@/components/modal";
import { Spinner } from "@/components/spinner";
import { Plus, FolderOpen, Loader2, Sparkles, ArrowRight } from "lucide-react";

export default function WorksPage() {
  return (
    <RequireWallet>
      <WorksGallery />
    </RequireWallet>
  );
}

function WorksGallery() {
  const { address } = useIdentity();
  const [works, setWorks] = useState<Work[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { works } = await apiGet<{ works: Work[] }>("/api/works");
      setWorks(works);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load works");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myWorks = works.filter(
    (w) => w.requester_addr.toLowerCase() === address?.toLowerCase()
  );

  if (loading) {
    return (
      <div className="card mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 py-14 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <p className="text-[15px] font-medium text-t2">Loading your productions…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md border-danger/30 bg-danger-subtle p-6 text-center">
        <p className="text-[15px] font-semibold text-danger">{error}</p>
        <button className="btn-ghost mt-4 inline-flex px-4 py-1.5 text-[13px]" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const openCount = myWorks.filter((w) => w.status === "open").length;
  const sealedCount = myWorks.filter((w) => w.status === "sealed").length;

  return (
    <div className="mx-auto w-full max-w-[1560px]">
      {/* ============ HERO ============ */}
      <section className="pt-4">
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          <span className="mr-3 inline-block h-[2px] w-8 bg-[color:var(--amber)] align-middle" />
          Producer desk
        </p>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="min-w-0">
            <h1 className="rf-display text-[clamp(2.6rem,6vw,4.75rem)] leading-[1.03] tracking-[-0.02em] text-t1">
              Plan the work.
              <br />
              Split the upside.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-t3 md:text-lg">
              Manage your productions. Foundry helps you plan tasks, review
              deliverables, and distribute royalties.
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="btn-sticker shrink-0 px-6 py-3 text-[13px] uppercase tracking-[0.08em]"
          >
            <Plus className="h-4 w-4" /> Create new project
          </button>
        </div>

        {/* Stat strip — hairline grid */}
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] sm:grid-cols-3">
          <HeroStat label="Total projects" value={myWorks.length} note="productions you own" />
          <HeroStat label="In production" value={openCount} note="open for contributors" />
          <HeroStat label="Sealed" value={sealedCount} note="released on-chain" tone="text-success" />
        </div>
      </section>

      {/* ============ MY PROJECTS ============ */}
      <section className="mt-16 pb-6">
        <SectionHead
          eyebrow="Your productions"
          title="My projects"
          aside={`${myWorks.length} total`}
        />

        {myWorks.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-7 w-7" />}
            title="No projects yet."
            body="Create your first project and Foundry will help you plan, assign, and produce."
            action={
              <button
                onClick={() => setCreateOpen(true)}
                className="btn-sticker mt-5 px-5 py-2.5 text-[13px] uppercase tracking-[0.08em]"
              >
                <Sparkles className="h-4 w-4" /> Create new project
              </button>
            }
          />
        ) : (
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--border-subtle)] md:grid-cols-2 xl:grid-cols-3">
            {myWorks.map((w) => (
              <WorkCard key={w.id} work={w} />
            ))}
          </div>
        )}
      </section>

      <CreateWorkModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        requesterAddr={address ?? ""}
      />
    </div>
  );
}

function WorkCard({ work }: { work: Work }) {
  return (
    <Link
      href={`/work/${work.slug || work.id}`}
      className="group flex flex-col bg-surface p-6 transition-colors hover:bg-surface-raised"
    >
      <div className="flex items-center justify-between gap-3">
        <WorkStatusPill status={work.status} />
        <span className="rf-data truncate text-[11px] text-t4">
          {work.requester_addr.slice(0, 6)}…{work.requester_addr.slice(-4)}
        </span>
      </div>

      <h3 className="rf-display mt-4 text-xl leading-snug text-t1">{work.title}</h3>
      <p className="mt-2 line-clamp-3 flex-1 text-[13px] leading-relaxed text-t3">
        {work.description || "No project brief outlined yet."}
      </p>

      <div className="mt-5 flex items-center justify-between border-t border-[color:var(--border-subtle)] pt-4">
        <span className="pill border-accent/30 bg-accent-subtle text-[11px] font-semibold text-accent">
          Owner
        </span>
        <span className="rf-data flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-[color:var(--amber)]">
          Open
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}

function CreateWorkModal({
  open,
  onClose,
  requesterAddr,
}: {
  open: boolean;
  onClose: () => void;
  requesterAddr: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { work } = await apiPost<{ work: Work }>("/api/works", {
        title: title.trim(),
        description: description.trim() || undefined,
        requesterAddr,
      });
      router.push(`/work/${work.slug || work.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create work");
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title="Create new project">
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="title">
            Project title
          </label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Pixel Odyssey (retro platformer)"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="description">
            Project description
          </label>
          <textarea
            id="description"
            className="input min-h-[100px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your creative vision — genre, theme, scope, team size..."
            disabled={submitting}
          />
        </div>

        {error && <p className="text-xs font-semibold text-danger">{error}</p>}

        <div className="rounded-xl border border-accent/25 bg-accent-subtle p-4 text-xs leading-relaxed text-t3">
          <span className="font-semibold text-t2">AI-ready.</span> After creating, Foundry will
          help you plan tasks, assign roles, and generate a production roadmap.
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-sticker px-5 py-2 text-[13px] uppercase tracking-[0.08em]"
            disabled={submitting || !title.trim()}
          >
            {submitting ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              "Create project"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
