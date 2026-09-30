import type { WorkStatus, BountyStatus } from "@/lib/supabase";

const WORK_TONE: Record<WorkStatus, string> = {
  open: "bg-white/[0.03] text-t3 border-white/5",
  sealed: "bg-verified-subtle text-verified border-verified/20",
};

export function WorkStatusPill({ status }: { status: WorkStatus }) {
  return (
    <span className={`pill ${WORK_TONE[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'sealed' ? 'bg-verified' : 'bg-t4'}`} />
      {status === "sealed" ? "Sealed" : "Open"}
    </span>
  );
}

const BOUNTY_CONFIG: Record<BountyStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-white/[0.03] text-t3 border-white/5" },
  claimed: { label: "Claimed", tone: "bg-warning-subtle text-warning border-warning/20" },
  delivered: { label: "Under Review", tone: "bg-accent-subtle text-accent border-accent/20" },
  approved: { label: "Approved", tone: "bg-success-subtle text-success border-success/20" },
  minted: { label: "Completed", tone: "bg-verified-subtle text-verified border-verified/20" },
};

export function BountyStatusPill({
  status,
  label,
}: {
  status: BountyStatus;
  label?: string;
}) {
  const conf = BOUNTY_CONFIG[status];
  return <span className={`pill font-semibold text-[10px] uppercase tracking-wider ${conf.tone}`}>{label ?? conf.label}</span>;
}
