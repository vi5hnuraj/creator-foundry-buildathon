/**
 * CLIENT-SIDE mirror of buildRevenueSplit() in src/lib/asset-forge.ts.
 *
 * asset-forge.ts can't be imported here (it reaches for viem's server transport
 * and node-only APIs), so this is a faithful copy of the *numeric rule* used for
 * the seal screen's preview. The canonical, on-chain-authoritative computation
 * happens server-side: the breakdown returned by POST /api/works/:id/seal is
 * what gets displayed after sealing. Keep this in sync with buildRevenueSplit.
 *
 * Rule: the principal keeps the remainder (100 - Σ participants); the fee is
 * inserted underneath by scaling the creator side into the (100 - fee)% pot;
 * ratios are integers and all rounding remainder goes to the principal.
 */
export const FORGE_FEE_PERCENT = 3;

export type SplitPreview = {
  principalPercent: number; // principal's share in the 0–100 mental model
  principalRatio: number; // principal's on-chain integer ratio
  participantRatios: number[]; // aligned to the input order
  feePercent: number;
  total: number; // always 100
};

/**
 * A royalty recipient row for display: who receives what % of every sale.
 * `ratio` is the on-chain %, or null when the recipient isn't in the split yet
 * (e.g. a participant with no minted asset). `assigned` is the % of the work the
 * producer granted, used to hint when rounding moved the on-chain value.
 */
export type RoyaltyRow = {
  role: string;
  address: string;
  ratio: number | null;
  assigned?: number;
  tint?: "info";
  dim?: boolean;
};

/**
 * Rebuild the on-chain royalty recipients (principal + minted participants +
  * 3% Creator Foundry fee) for a sealed work, same rule as buildRevenueSplit. The fee
 * wallet address isn't known client-side, so its row carries no address.
 */
export function buildRoyaltyRows(
  principalAddress: string,
  participants: { address: string; role: string; percent: number }[]
): RoyaltyRow[] {
  const preview = computeSplitPreview(participants.map((p) => p.percent));
  const rows: RoyaltyRow[] = [
    { role: "principal", address: principalAddress, ratio: preview.principalRatio },
  ];
  participants.forEach((p, i) =>
    rows.push({ role: p.role, address: p.address, ratio: preview.participantRatios[i] })
  );
  rows.push({ role: "platform_fee", address: "", ratio: preview.feePercent, tint: "info" });
  return rows;
}

export function computeSplitPreview(
  participantPercents: number[],
  feePercent: number = FORGE_FEE_PERCENT
): SplitPreview {
  const participantTotal = participantPercents.reduce((s, p) => s + p, 0);
  const principalPercent = Math.max(0, 100 - participantTotal);

  // principal first, then participants — same ordering as buildRevenueSplit.
  const creatorSide = [principalPercent, ...participantPercents];
  const creatorPot = 100 - feePercent;

  const ratios = creatorSide.map((p) => Math.floor((p / 100) * creatorPot));
  // Min 1% for any participant with a positive share (mirror buildRevenueSplit).
  for (let i = 1; i < ratios.length; i++) {
    if (participantPercents[i - 1] > 0 && ratios[i] === 0) ratios[i] = 1;
  }
  // Principal keeps the remainder of the pot.
  const participantsUsed = ratios.slice(1).reduce((s, x) => s + x, 0);
  ratios[0] = creatorPot - participantsUsed;

  return {
    principalPercent,
    principalRatio: ratios[0],
    participantRatios: ratios.slice(1),
    feePercent,
    total: ratios.reduce((s, x) => s + x, 0) + feePercent,
  };
}
