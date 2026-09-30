import { Spinner } from "./spinner";

/**
 * Calm transaction-pending indicator (DESIGN_SPEC): spinner + a reassuring
 * label on a card, with optional sequential steps in mono. These are real txs
 * (30s–2min) — copy should reassure, not alarm.
 */
export function TxPending({
  title,
  steps,
}: {
  title: string;
  steps?: string[];
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 font-medium text-t1">
        <Spinner /> {title}
      </div>
      {steps && steps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {steps.map((s) => (
            <li key={s} className="rf-data text-sm text-t3">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
