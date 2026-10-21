import { clean } from './room-number-to-category.mjs';

/** Leasing placeholder on contracts — not the guest login address. */
export function isPropertyPlaceholderEmail(email) {
  const e = clean(email).toLowerCase().replace(/^\/+/, '');
  if (!e || !e.includes('@')) return false;
  return /^hola\.car@(?:episode\.life|nodeliving\.es)/i.test(e);
}

/** Prefer real guest emails over property placeholders when merging sources. */
export function pickGuestEmail(normalize, ...rawFields) {
  const all = rawFields.map(normalize).filter(Boolean);
  if (!all.length) return null;
  const real = all.filter((e) => !isPropertyPlaceholderEmail(e));
  return real[0] || all[0];
}
