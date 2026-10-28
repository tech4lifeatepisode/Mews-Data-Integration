/**
 * Give every V4 reservation a real Seguimiento NC (no HM_ / negative placeholder NCs), fix person rows whose NC
 * belongs to someone else in Seguimiento, and fill Document Type / split merged guests on current reservations.
 * Applies the same changes to V3 B2B / B2C; logs every change or gap in Missing_Occupied_NCs_21_10_2026.
 * Placeholder rows with no Seguimiento match are moved from V4 / V3 to the missing table.
 *
 *   node rekey-v4-ncs-from-seguimiento-21-10-2026.mjs           (dry run)
 *   node rekey-v4-ncs-from-seguimiento-21-10-2026.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { documentTypeForId, normNameToken, normalizeTenantId, parseCsvRows, parseDdMmYyyy } from './tenancy-nc-overrides.mjs';
import { clean } from './room-number-to-category.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SEGUIMIENTO_CSV = path.join(
  root,
  'contract-analysis',
  'External Data Sources',
  'Seguimiento Leasing Carabanchel (new .LIFE) .xlsx - Leasing Update (1).csv',
);
const APPLY = process.argv.includes('--apply');
const TODAY = process.env.AUDIT_TODAY || '2026-10-21';

const V4 = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V3_TABLES = ['V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026', 'V3_Final_B2C_All_Fields_Match_Mews_Import_20_10_2026'];
const MISSING = 'Missing_Occupied_NCs_21_10_2026';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...transcriptText.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

const NAME_STOP = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'dos', 'van', 'von', 'sl', 'sa', 'slu', 'sau']);

/**
 * Name key: plain tokens (hyphenated surnames joined: "El - Hachem" = "El-Hachem" = elhachem)
 * plus adjacent-pair joins ("Mc Tigue" → mctigue) used only against the other side's plain tokens.
 */
function nameKeySet(...parts) {
  const plain = new Set();
  const joined = new Set();
  for (const p of parts) {
    const words = clean(p).replace(/\s*-\s*/g, '').split(/[\s,|]+/).filter(Boolean);
    for (const w of words) {
      const n = normNameToken(w);
      if (n.length > 1 && !NAME_STOP.has(n)) plain.add(n);
    }
    for (let i = 0; i + 1 < words.length; i++) joined.add(normNameToken(words[i] + words[i + 1]));
  }
  return { plain, joined };
}

function nameScore(a, b) {
  let n = 0;
  for (const t of a.plain) if (b.plain.has(t) || b.joined.has(t)) n++;
  for (const t of a.joined) if (b.plain.has(t) && !a.plain.has(t)) n++;
  return n;
}

/** ≥2 shared tokens, and all of the shorter name's tokens when it has ≤3 (avoids "Javier Hernández" collisions). */
function strongMatch(a, b) {
  const n = nameScore(a, b);
  return n >= 2 && n >= Math.min(3, a.plain.size, b.plain.size);
}

function isoDate(v) {
  const m = clean(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : parseDdMmYyyy(clean(v));
}

function overlapDays(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return Math.max(0, Math.round((Date.parse(e) - Date.parse(s)) / 86400000));
}

const ncCode = (nc) => `NC_${String(nc).padStart(4, '0')}`;

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------- Seguimiento ----------

const seg = new Map();
{
  const table = parseCsvRows(fs.readFileSync(SEGUIMIENTO_CSV, 'utf8').replace(/^\uFEFF/, ''));
  const hIdx = table.findIndex((r) => clean(r[1]) === 'Unique code');
  for (const c of table.slice(hIdx + 1)) {
    const m = clean(c[1]).match(/^NC_0*(\d+)$/i);
    if (!m) continue;
    const name1 = `${clean(c[6])} ${clean(c[7])}`.trim();
    const name2 = `${clean(c[8])} ${clean(c[9])}`.trim();
    seg.set(Number(m[1]), {
      nc: Number(m[1]),
      category: clean(c[3]),
      status: clean(c[4]),
      label: clean(c[5]),
      name1,
      name2,
      guarantor: clean(c[10]),
      t1: nameKeySet(name1),
      t2: nameKeySet(name2),
      tg: nameKeySet(clean(c[10])),
      residents: Number(clean(c[13])) || null,
      start: isoDate(c[17]),
      end: isoDate(c[19]) || isoDate(c[18]),
    });
  }
}

const cancelled = (s) => /cancel/i.test(`${s.status} ${s.label}`);

/** Company tenant on the Tenancy stay for a door (B2B guests whose V4 row has no Partner Company). */
const tenancyCompaniesByDoor = new Map();
{
  const tenancyCsv = path.join(root, 'contract-analysis', 'External Data Sources', 'Tenancy-14-10-2026-044225.csv');
  const table = parseCsvRows(fs.readFileSync(tenancyCsv, 'utf8').replace(/^\uFEFF/, ''));
  const h = table[0];
  const col = (n) => h.indexOf(n);
  for (const c of table.slice(1)) {
    const types = clean(c[col('Tenant Type')]).split(/\s*\|\s*/);
    const names = clean(c[col('Tenant Name')]).split(/\s*,\s*/);
    const companyIdx = types.findIndex((t) => /company/i.test(t));
    if (companyIdx < 0 || !names[companyIdx]) continue;
    const door = clean(c[col('Door')]).replace(/^(-?)0*(\d)/, '$1$2');
    if (!tenancyCompaniesByDoor.has(door)) tenancyCompaniesByDoor.set(door, []);
    tenancyCompaniesByDoor.get(door).push({
      name: names[companyIdx],
      start: parseDdMmYyyy(clean(c[col('Contract Start Date')])),
      end: parseDdMmYyyy(clean(c[col('Move out date')])) || parseDdMmYyyy(clean(c[col('Contract End Date')])),
    });
  }
}

function companyForStay(r, a, d) {
  if (clean(r['Partner Company'])) return clean(r['Partner Company']);
  const door = clean(r['Allocated Room Number']).replace(/^(-?)0*(\d)/, '$1$2');
  return (tenancyCompaniesByDoor.get(door) || []).find((t) => overlapDays(a, d, t.start, t.end) > 0)?.name || null;
}

function dayGap(a, b) {
  return a && b ? Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000)) : Infinity;
}

/**
 * Best Seguimiento NC for a stay. Person match on resident names (guarantor as fallback, flagged);
 * company contracts (B2B rows list the company) match on company name + start/end within 3 days.
 * Ranked by name score, then active before cancelled, then most shared nights.
 */
function bestSegNc(personKeys, companyKeys, start, end) {
  const cands = [];
  for (const s of seg.values()) {
    const days = overlapDays(start, end, s.start, s.end);
    if (days < 1) continue;
    let score = 0;
    let via = null;
    if (strongMatch(personKeys, s.t1) || strongMatch(personKeys, s.t2)) {
      score = Math.max(nameScore(personKeys, s.t1), nameScore(personKeys, s.t2)) + 10;
      via = 'resident';
    } else if (s.guarantor && strongMatch(personKeys, s.tg)) {
      score = nameScore(personKeys, s.tg) + 5;
      via = 'guarantor';
    } else if (
      companyKeys &&
      s.category === 'B2B' &&
      strongMatch(companyKeys, s.t1) &&
      dayGap(start, s.start) <= 3 &&
      dayGap(end, s.end) <= 3
    ) {
      score = nameScore(companyKeys, s.t1);
      via = 'company_and_dates';
    }
    if (via) cands.push({ s, days, score, via });
  }
  cands.sort((a, b) => b.score - a.score || Number(cancelled(a.s)) - Number(cancelled(b.s)) || b.days - a.days);
  return cands[0] ? { ...cands[0], all: cands } : null;
}

function describeSeg(s) {
  return `${ncCode(s.nc)} ${[s.name1, s.name2].filter(Boolean).join(' + ')} (${s.status}/${s.label}, ${s.start}→${s.end})`;
}

// ---------- plan ----------

const v4Rows = await fetchAll(V4);
const v4ByNc = new Map(v4Rows.map((r) => [Number(r.nc_number), r]));

function guestKeys(r) {
  return nameKeySet([r['First Name'], r['Last Name(*)'], r['Second Last Name']].filter(Boolean).join(' '));
}

const COMPANY_RE = /\b(s\.?\s?l\.?\s?u?|s\.?\s?a\.?\s?u?|ltd|gmbh|inc|llc)\b|,\s*s\.?l\.?/i;

function isCompanyGuest(r) {
  const full = `${clean(r['First Name'])} ${clean(r['Last Name(*)'])}`;
  return COMPANY_RE.test(full) || (clean(r['Partner Company']) && normNameToken(full) === normNameToken(r['Partner Company']));
}

const rekeys = [];
const unmatched = [];
const unmatchedNotes = new Map();
const duplicates = [];
for (const r of v4Rows) {
  const nc = Number(r.nc_number);
  if (isCompanyGuest(r)) continue;
  const keys = guestKeys(r);
  const a = isoDate(r['Arrival Date(*)']);
  const d = isoDate(r['Departure Date(*)']);
  const company = companyForStay(r, a, d);
  const companyKeys = company ? nameKeySet(company) : null;
  const current = seg.get(nc);
  const currentOk =
    current &&
    (strongMatch(keys, current.t1) ||
      strongMatch(keys, current.t2) ||
      (companyKeys && current.category === 'B2B' && strongMatch(companyKeys, current.t1)));
  if (nc > 0 && (currentOk || !current || current.category === 'B2B')) continue;
  const best = bestSegNc(keys, companyKeys, a, d);
  if (best && cancelled(best.s)) {
    // Only cancelled Seguimiento contracts match: not a usable NC.
    if (nc < 0) {
      unmatched.push(r);
      unmatchedNotes.set(nc, `Only cancelled Seguimiento contracts match: ${best.all.map((c) => describeSeg(c.s)).join('; ')}`);
    }
    continue;
  }
  if (!best || best.s.nc === nc) {
    if (nc < 0) unmatched.push(r);
    continue;
  }
  const occupant = v4ByNc.get(best.s.nc);
  const sameDoc = occupant && clean(occupant['Document Number']) && clean(occupant['Document Number']) === clean(r['Document Number']);
  if (sameDoc && overlapDays(a, d, isoDate(occupant['Arrival Date(*)']), isoDate(occupant['Departure Date(*)'])) > 0) {
    duplicates.push({ row: r, of: occupant, seg: current });
    continue;
  }
  rekeys.push({
    row: r,
    from: nc,
    to: best.s.nc,
    seg: best.s,
    days: best.days,
    via: best.via,
    reason: nc < 0 ? 'placeholder_nc' : 'nc_belongs_to_other_guest',
  });
}

// Resolve chains (1924 → 1923 frees 1924 for the placeholder row) and refuse collisions.
const movingAway = new Set([...rekeys.map((k) => k.from), ...duplicates.map((d) => Number(d.row.nc_number))]);
const claimedTargets = new Set();
const accepted = [];
const rejected = [];
for (const k of rekeys.sort((x, y) => y.days - x.days)) {
  const occupant = v4ByNc.get(k.to);
  const free = (!occupant || movingAway.has(k.to)) && !claimedTargets.has(k.to);
  if (free) {
    claimedTargets.add(k.to);
    accepted.push(k);
  } else rejected.push({ ...k, occupiedBy: occupant ? `${occupant['First Name']} ${occupant['Last Name(*)']}` : 'another re-key' });
}
for (const k of rejected) if (k.from < 0) unmatched.push(k.row);

// Current reservations: Document Type, merged guests ("A, B" + "ID1 | ID2").
const docFixes = [];
for (const r of v4Rows) {
  const a = isoDate(r['Arrival Date(*)']);
  const d = isoDate(r['Departure Date(*)']);
  if (!(a && a <= TODAY && d && d >= TODAY)) continue;
  if (isCompanyGuest(r)) continue;
  const docs = clean(r['Document Number']).split(/\s*\|\s*/).filter(Boolean);
  const merged = docs.length > 1 || /,/.test(`${r['First Name']} ${r['Last Name(*)']}`);
  if (!merged && (!docs.length || clean(r['Document Type']))) continue;
  const patch = {};
  if (merged) {
    const full = `${clean(r['First Name'])} ${clean(r['Last Name(*)'])}`.trim();
    const people = full.split(/\s*,\s*/).filter(Boolean);
    const first = people[0].split(/\s+/);
    patch['First Name'] = first.length > 1 ? first.slice(0, first.length > 3 ? 2 : 1).join(' ') : null;
    patch['Last Name(*)'] = first.slice(first.length > 3 ? 2 : 1).join(' ') || first[0];
    patch['Document Number'] = docs[0] || null;
    const companions = people.slice(1);
    const extraDocs = docs.slice(1);
    if (companions.length || extraDocs.length) {
      const note = companions.length
        ? `Companion(s) (not imported - add in Mews or re-import with customer ID): ${companions.join(', ')}${
            extraDocs.length ? ` (${extraDocs.join(', ')})` : ''
          }`
        : `Companion document(s) (not imported): ${extraDocs.join(', ')}`;
      if (!clean(r['Reservation Notes']).includes('Companion')) patch['Reservation Notes'] = `${clean(r['Reservation Notes'])} | ${note}`;
      patch['Adult Count(*)'] = String(Math.max(Number(r['Adult Count(*)']) || 1, people.length, docs.length));
    }
  }
  const docNumber = patch['Document Number'] ?? docs[0];
  if (docNumber) patch['Document Type'] = documentTypeForId(docNumber);
  docFixes.push({ row: r, patch });
}

// ---------- missing-table log ----------

const logBase = (r) => ({
  nc_source: 'seguimiento_leasing_csv',
  door: clean(r['Allocated Room Number']) || null,
  unit_category: clean(r['Allocated Room Category(*)']) || null,
  contract_start: isoDate(r['Arrival Date(*)']),
  contract_end: isoDate(r['Departure Date(*)']),
  deposit: clean(r['Prepaid Amount']) || null,
  v4_guest: `${clean(r['First Name'])} ${clean(r['Last Name(*)'])}`.trim(),
  v4_room: clean(r['Allocated Room Number']) || null,
  tenancy_contract_id: clean(r['Reservation Notes']).match(/HouseMonk tenancy (\d+)/)?.[1] || null,
});

const logRows = [];
for (const k of accepted) {
  const s = k.seg;
  const flags = [];
  if (cancelled(s)) flags.push(`Seguimiento ${ncCode(s.nc)} is ${s.status} / ${s.label} but Tenancy shows the stay — confirm the NC`);
  if (k.via === 'guarantor') flags.push(`V4 guest is the Seguimiento guarantor; resident is ${s.name1}`);
  logRows.push({
    issue_type: k.reason === 'placeholder_nc' ? 'v4_placeholder_nc_rekeyed' : 'v4_nc_belonged_to_other_guest',
    resolution: flags.length ? 'rekeyed_needs_review' : 'rekeyed_to_seguimiento_nc',
    nc_number: s.nc,
    ...logBase(k.row),
    seguimiento_nc: ncCode(s.nc),
    seguimiento_label: [s.status, s.label].filter(Boolean).join(' / '),
    seguimiento_names: [s.name1, s.name2].filter(Boolean).join(', '),
    seguimiento_end: s.end,
    notes: [
      `NC ${k.from < 0 ? `HM placeholder ${k.from}` : k.from} → ${ncCode(s.nc)} (matched on ${k.via.replace(/_/g, ' ')}, ${k.days} nights shared with Seguimiento contract)`,
      ...flags,
    ].join(' | '),
  });
}
for (const dup of duplicates) {
  const s = dup.seg;
  logRows.push({
    issue_type: 'v4_duplicate_reservation',
    resolution: 'removed_from_v4',
    nc_number: Number(dup.row.nc_number),
    ...logBase(dup.row),
    seguimiento_nc: s ? ncCode(s.nc) : null,
    seguimiento_label: s ? [s.status, s.label].filter(Boolean).join(' / ') : null,
    seguimiento_names: s ? [s.name1, s.name2].filter(Boolean).join(', ') : null,
    seguimiento_end: s?.end || null,
    notes: `Same guest, document and dates as ${ncCode(dup.of.nc_number)} (${clean(dup.of['First Name'])} ${clean(dup.of['Last Name(*)'])}); Seguimiento ${
      s ? `${ncCode(s.nc)} belongs to ${[s.name1, s.name2].filter(Boolean).join(', ')}, who is not in Tenancy` : 'has no row for this NC'
    }`,
  });
}
for (const r of unmatched) {
  logRows.push({
    issue_type: 'v4_placeholder_nc_no_seguimiento_match',
    resolution: 'removed_from_v4',
    nc_number: Number(r.nc_number),
    ...logBase(r),
    notes: `${unmatchedNotes.get(Number(r.nc_number)) || 'No Seguimiento NC matches this guest and stay'}; removed from V4 / V3 until an NC is confirmed`,
  });
}
for (const f of docFixes) {
  logRows.push({
    issue_type: 'v4_current_document_fixed',
    resolution: 'filled',
    nc_number: Number(f.row.nc_number),
    ...logBase(f.row),
    nc_source: 'v4',
    notes: `Document: ${clean(f.row['Document Number'])} → ${f.patch['Document Number'] ?? clean(f.row['Document Number'])} (${f.patch['Document Type']})${
      f.patch['Last Name(*)'] ? ` | guest split to ${[f.patch['First Name'], f.patch['Last Name(*)']].filter(Boolean).join(' ')}` : ''
    }`,
  });
}

const summary = {
  apply: APPLY,
  rekeyed: accepted.map((k) => `${k.from} → ${k.to} ${clean(k.row['First Name'])} ${clean(k.row['Last Name(*)'])} (${k.reason})`),
  rejected: rejected.map((k) => `${k.from} → ${k.to} blocked by ${k.occupiedBy}`),
  unmatchedPlaceholders: unmatched.map((r) => `${r.nc_number} ${clean(r['First Name'])} ${clean(r['Last Name(*)'])}`),
  duplicatesRemoved: duplicates.map((d) => `${d.row.nc_number} duplicates ${d.of.nc_number} (${clean(d.of['First Name'])} ${clean(d.of['Last Name(*)'])})`),
  flagged: logRows.filter((l) => l.resolution === 'rekeyed_needs_review').map((l) => `${l.nc_number}: ${l.notes}`),
  documentFixes: docFixes.map((f) => `${f.row.nc_number}: ${JSON.stringify(f.patch).slice(0, 160)}`),
  logRows: logRows.length,
};

// ---------- apply ----------

function rekeyPatch(k) {
  const notes = clean(k.row['Reservation Notes'])
    .replace(/\s*\|\s*No NC in HouseMonk \/ Seguimiento/g, '')
    .replace(/^No NC in HouseMonk \/ Seguimiento\s*\|\s*/, '');
  return {
    nc_number: k.to,
    'Group Code': ncCode(k.to),
    'Internal Guest Notes': ncCode(k.to),
    'Reservation Notes': notes,
  };
}

async function applyTo(table) {
  const rows = await fetchAll(table);
  const present = new Set(rows.map((r) => Number(r.nc_number)));
  const out = { rekeyed: 0, removed: 0, docFixed: 0 };
  const parked = accepted.filter((k) => present.has(k.from));
  for (const [i, k] of parked.entries()) {
    const { error } = await sb.from(table).update({ nc_number: -(990000 + i) }).eq('nc_number', k.from);
    if (error) throw new Error(`${table} park ${k.from}: ${error.message}`);
  }
  for (const [i, k] of parked.entries()) {
    const { error } = await sb.from(table).update(rekeyPatch(k)).eq('nc_number', -(990000 + i));
    if (error) throw new Error(`${table} rekey ${k.from}→${k.to}: ${error.message}`);
    out.rekeyed++;
  }
  for (const r of [...unmatched, ...duplicates.map((d) => d.row)]) {
    if (!present.has(Number(r.nc_number))) continue;
    const { error } = await sb.from(table).delete().eq('nc_number', r.nc_number);
    if (error) throw new Error(`${table} remove ${r.nc_number}: ${error.message}`);
    out.removed++;
  }
  for (const f of docFixes) {
    if (!present.has(Number(f.row.nc_number))) continue;
    const { error } = await sb.from(table).update(f.patch).eq('nc_number', f.row.nc_number);
    if (error) throw new Error(`${table} doc ${f.row.nc_number}: ${error.message}`);
    out.docFixed++;
  }
  return out;
}

if (APPLY) {
  fs.mkdirSync(path.join(here, 'backups'), { recursive: true });
  const backup = { [V4]: v4Rows };
  for (const t of V3_TABLES) backup[t] = await fetchAll(t);
  fs.writeFileSync(
    path.join(here, 'backups', `v3-v4-before-nc-rekey-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(backup),
  );
  summary.tables = {};
  for (const t of [V4, ...V3_TABLES]) summary.tables[t] = await applyTo(t);

  // Earlier log rows for these placeholder NCs now point at the real NC.
  for (const k of accepted.filter((x) => x.from < 0)) {
    await sb
      .from(MISSING)
      .update({ nc_number: k.to, nc_source: 'seguimiento_name', resolution: 'added_to_v4', seguimiento_nc: ncCode(k.to) })
      .eq('nc_number', k.from)
      .eq('issue_type', 'tenancy_active_not_in_v4');
  }
  for (const r of unmatched) {
    await sb
      .from(MISSING)
      .update({ resolution: 'removed_from_v4_no_seguimiento_nc' })
      .eq('nc_number', r.nc_number)
      .eq('issue_type', 'tenancy_active_not_in_v4');
  }
  const { error } = await sb.from(MISSING).insert(logRows);
  if (error) throw new Error(`log: ${error.message}`);
}

console.log(JSON.stringify(summary, null, 2));
