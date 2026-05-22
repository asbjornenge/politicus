export function formatBitDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export const LOW_BALANCE_TEZ = 0.5;

export function formatTez(tez: number): string {
  if (tez >= 100) return tez.toFixed(0);
  if (tez >= 10) return tez.toFixed(1);
  if (tez >= 1) return tez.toFixed(2);
  return tez.toFixed(3);
}

export function pendingVoteTotal(
  myDirection: 'up' | 'down' | null,
  myVotes: number | null,
  pendingDirection: 'up' | 'down',
  pendingCount: number,
): number {
  const base = myDirection === pendingDirection ? (myVotes ?? 0) : 0;
  return base + pendingCount;
}

export function quadraticCostTez(
  unitCostMutez: string | null | undefined,
  votes: number,
): number | null {
  if (!unitCostMutez || votes < 1) return null;
  return (Number(unitCostMutez) * votes * votes) / 1_000_000;
}
