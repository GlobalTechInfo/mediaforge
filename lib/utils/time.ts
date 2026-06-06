export function toSeconds(ts: string | number | undefined): number | null {
  if (ts === undefined) return null;
  if (typeof ts === 'number') return ts;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) {
    if (parts.some(isNaN)) return null;
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    if (parts.some(isNaN)) return null;
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  const parsed = parseFloat(ts);
  return isNaN(parsed) ? null : parsed;
}

export function toSecondsStrict(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  const parts = ts.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  const parsed = parseFloat(ts);
  return isNaN(parsed) ? 0 : parsed;
}
