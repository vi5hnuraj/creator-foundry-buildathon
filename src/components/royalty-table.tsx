import type { RoyaltyRow } from "@/lib/split-math";
import { Address } from "./data";

function prettyRole(role: string): string {
  if (role === "principal") return "Principal";
  if (role === "platform_fee") return "Creator Foundry";
  return role;
}

/**
 * Royalty recipients of a sealed work — who receives what % of every sale.
 * Reinforces the transparency story (every split is publicly verifiable).
 * Creator Foundry's fee row is tinted --info.
 */
export function RoyaltyTable({ rows }: { rows: RoyaltyRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="rf-eyebrow text-left">
          <th className="pb-2">Recipient</th>
          <th className="pb-2">Address</th>
          <th className="pb-2 text-right">Per sale</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const rounded = r.ratio !== null && r.assigned != null && r.assigned !== r.ratio;
          return (
            <tr key={i} className="border-t border-[color:var(--border-subtle)]">
              <td className={`py-2 ${r.tint === "info" ? "text-info" : r.dim ? "text-t4" : "text-t2"}`}>
                {prettyRole(r.role)}
              </td>
              <td className="py-2">
                {r.address ? (
                  <Address value={r.address} link />
                ) : (
                  <span className="rf-data text-t4">protocol</span>
                )}
              </td>
              <td className={`rf-data py-2 text-right ${r.dim ? "text-t4" : "text-t1"}`}>
                {r.ratio === null ? (
                  "—"
                ) : (
                  <>
                    {r.ratio}%
                    {rounded && (
                      <span
                        className="ml-1 text-xs text-t4"
                        title={`${r.assigned}% of the work, rounded to an integer`}
                      >
                        ({r.assigned}%)
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
