import type { ReactNode } from "react";

/**
 * Shared editorial building blocks (amber-dash eyebrows, serif stat cells,
 * hairline section headers, empty states) used by the Producer Desk and
 * Contributor Hub so both pages read as one design language.
 */

export function HeroStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | number;
  note: string;
  tone?: string;
}) {
  return (
    <div className="bg-surface px-6 py-5">
      <div className="rf-data text-[10px] uppercase tracking-[0.18em] text-t4">{label}</div>
      <div className={`rf-display mt-2 text-3xl leading-none ${tone ?? "text-t1"}`}>{value}</div>
      <div className="mt-1.5 text-xs text-t4">{note}</div>
    </div>
  );
}

export function SectionHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--border-subtle)] pb-5">
      <div>
        <p className="rf-data text-xs uppercase tracking-[0.22em] text-t3">
          <span className="mr-3 inline-block h-[2px] w-8 bg-[color:var(--amber)] align-middle" />
          {eyebrow}
        </p>
        <h2 className="rf-display mt-3 text-3xl leading-none text-t1 md:text-4xl">{title}</h2>
      </div>
      <span className="rf-data text-xs uppercase tracking-[0.18em] text-t4">{aside}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-[color:var(--border)] bg-surface px-6 py-14 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-t4">
        {icon}
      </span>
      <p className="rf-display mt-4 text-2xl text-t2">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-t4">{body}</p>
      {action}
    </div>
  );
}
