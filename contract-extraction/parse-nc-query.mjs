/** Parse ?nc= / ?ncs= for Render extract routes. Ignores blank values and NC 0. */
export function parseNcNumbersFromQuery(ncRaw) {
  const raw = String(ncRaw ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^NC_/i, ''))
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0);
}
