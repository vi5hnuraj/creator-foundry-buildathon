/**
 * Metric block — label above, big number in mono (.rf-data, tabular) below.
 * Sits on --surface-raised. Used by the bounty board and store (DESIGN_SPEC).
 */
export function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-surface-raised p-4">
      <div className="text-sm text-t3">{label}</div>
      <div className="rf-data mt-1 text-2xl text-t1">{value}</div>
    </div>
  );
}
