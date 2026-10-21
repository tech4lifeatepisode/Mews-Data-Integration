/**
 * Build HouseMonk_Tenancy_Lifecycle_NC_14_10_2026 from Tenancy CSV + Final_Format_HouseMonk (NC required).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { clean } from './room-number-to-category.mjs';
import {
  DEFAULT_TENANCY_CSV,
  loadTenancyLookup,
} from './tenancy-nc-overrides.mjs';

const TABLE = 'HouseMonk_Tenancy_Lifecycle_NC_14_10_2026';
const HM_TABLE = 'Final_Format_HouseMonk_15_10_2026';
const SNAPSHOT_ISO = '2026-10-14';
/** Align with V2 Mews import — reservation end on or after this date (YYYY-MM-DD). */
const MIN_DEPARTURE_DATE = process.env.MEWS_MIN_DEPARTURE_DATE || '2026-11-05';

const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const transcriptText = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
function lastMatch(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const m = [...transcriptText.matchAll(new RegExp(pattern.source, flags))];
  return m.length ? m.at(-1)[0] : null;
}
const url = process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  lastMatch(/sb_secret_[A-Za-z0-9_\-]+/);
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(url, key);

function ncFromHmRow(row) {
  const nums = new Set();
  for (const t of [row['Group Code'], row['Internal Guest Notes']].filter(Boolean)) {
    for (const m of String(t).matchAll(/NC_0*(\d+)/gi)) nums.add(Number(m[1]));
  }
  if (row.nc_number != null && Number.isFinite(Number(row.nc_number))) nums.add(Number(row.nc_number));
  return [...nums];
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const c = clean(v);
    if (c && c !== '/' && c !== '-') return c;
  }
  return null;
}

function splitPipeField(raw) {
  const c = clean(raw);
  if (!c) return [];
  return c.split(/\s*\|\s*/).map((p) => clean(p)).filter(Boolean);
}

function normalizeTenantId(id) {
  return clean(id).toUpperCase().replace(/\s/g, '');
}

function normGuestName(first, last) {
  return `${clean(first)} ${clean(last)}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stable keys to match the same person across tenancies (doc > email > name). */
function guestMatchKeys(row) {
  const keys = new Set();
  for (const raw of [row.guest_document_number, ...splitPipeField(row.tenancy_tenant_id)]) {
    const doc = normalizeTenantId(raw);
    if (doc.length >= 6 && !/^PEDIR$/i.test(doc)) keys.add(`doc:${doc}`);
  }
  const em = clean(row.guest_email).toLowerCase();
  if (em.includes('@') && !em.includes('lead@guest')) keys.add(`email:${em}`);
  const name = normGuestName(row.guest_first_name, row.guest_last_name);
  if (name.length > 5) keys.add(`name:${name}`);
  return keys;
}

function reservationEndIso(row) {
  return row.check_out_date || row.move_out_date || null;
}

function isCurrentOrFutureReservation(row) {
  const end = reservationEndIso(row);
  if (!end) return false;
  return end >= MIN_DEPARTURE_DATE;
}

function parseDdMmYyyy(raw) {
  const c = clean(raw);
  const m = c.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function normalizeRoom(door) {
  const d = clean(door);
  if (!d) return null;
  if (/^[0-9]+$/.test(d.replace(/^0+/, '') || '0')) return d.replace(/^0+/, '') || d;
  return d;
}

function lifecycleFlags(tenancy) {
  const flags = [];
  const st = clean(tenancy['Tenancy Status']);
  const cr = clean(tenancy['Cancellation Reason']);
  if (cr) flags.push('cancellation_reason');
  if (st === 'Occupied') flags.push('occupied');
  if (st === 'Shifted') flags.push('shifted');
  if (st === 'Booked') flags.push('booked');
  if (st === 'Under Notice') flags.push('under_notice');
  const mo = parseDdMmYyyy(tenancy['Move out date']);
  if (mo && mo < SNAPSHOT_ISO && st !== 'Occupied') flags.push('move_out_before_snapshot');
  return flags;
}

function lifecycleLabel(tenancy) {
  const st = clean(tenancy['Tenancy Status']);
  const cr = clean(tenancy['Cancellation Reason']);
  if (cr) return `Cancelled / reason: ${cr}`;
  if (st === 'Occupied') return 'Occupied';
  if (st === 'Shifted') return 'Shifted (move-out or room change)';
  if (st === 'Under Notice') return 'Under notice';
  if (st === 'Booked') return 'Booked (future or inactive)';
  return st || 'Unknown';
}

function pickTenancyEmail(raw) {
  for (const part of splitPipeField(raw)) {
    if (part.includes('@')) return part.toLowerCase();
  }
  const c = clean(raw);
  return c.includes('@') ? c.toLowerCase() : null;
}

function nameFromTenancy(raw) {
  const c = clean(raw);
  if (!c) return { first: null, last: null };
  const parts = c.split(',')[0].trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }
  return { first: null, last: c };
}

function scoreHmMatch(hm, tenancy, nc) {
  const tenantIds = splitPipeField(tenancy['Tenant ID']).map(normalizeTenantId);
  const hmDoc = normalizeTenantId(hm['Document Number']);
  if (hmDoc && tenantIds.includes(hmDoc)) return 100;
  const arr = parseDdMmYyyy(tenancy['Contract Start Date']);
  const hmArr = clean(hm['Arrival Date(*)']);
  if (arr && hmArr === arr) {
    const blob = `${hm['First Name']} ${hm['Last Name(*)']}`.toLowerCase();
    const tName = clean(tenancy['Tenant Name']).toLowerCase();
    if (tName && blob && (blob.includes(tName.split(' ')[0]) || tName.includes(clean(hm['First Name']).toLowerCase())))
      return 75;
    return 50;
  }
  const ncs = ncFromHmRow(hm);
  if (ncs.includes(nc)) return 25;
  return 0;
}

function bestHmForTenancy(hmByNc, hmAll, tenancy, nc) {
  const candidates = hmByNc.get(nc) || [];
  let best = null;
  let bestScore = 0;
  for (const hm of candidates) {
    const s = scoreHmMatch(hm, tenancy, nc);
    if (s > bestScore) {
      bestScore = s;
      best = hm;
    }
  }
  if (bestScore >= 50) return { hm: best, method: bestScore >= 100 ? 'document_id' : bestScore >= 75 ? 'name_and_arrival' : 'nc_and_arrival' };
  return { hm: candidates[0] || null, method: candidates[0] ? 'nc_only' : null };
}

function stripMeta(row) {
  const { id, created_at, ...rest } = row;
  return rest;
}

function hmSnapshot(row) {
  if (!row) return null;
  return stripMeta({ ...row });
}

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const MISSING_COL_RE = /Could not find the '([^']+)' column/;
const MISSING_TABLE_RE = /Could not find the table '([^']+)'/;

function isBenignDeleteError(message = '') {
  return /does not exist/i.test(message) || /schema cache/i.test(message) || MISSING_TABLE_RE.test(message);
}

function isMissingTableError(message = '') {
  if (MISSING_COL_RE.test(message)) return false;
  return MISSING_TABLE_RE.test(message) || (/schema cache/i.test(message) && !/column/i.test(message));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sqlLiteral(v) {
  if (v == null || v === '') return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function writeSeedSql(table, rows, filePath) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const lines = [
    `-- Seed ${table} (${rows.length} rows)`,
    'begin;',
    `delete from public."${table}" where nc_number >= 0;`,
  ];
  for (const row of rows) {
    const vals = cols.map((c) => sqlLiteral(row[c]));
    lines.push(
      `insert into public."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) values (${vals.join(', ')});`,
    );
  }
  lines.push('commit;');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function replaceTable(table, rows) {
  const { error: delError } = await sb.from(table).delete().gte('nc_number', 0);
  if (delError && !isBenignDeleteError(delError.message)) throw delError;

  const omit = new Set();
  for (;;) {
    let failed = null;
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40).map((r) => {
        const out = { ...r };
        for (const c of omit) delete out[c];
        return out;
      });
      const { error } = await sb.from(table).insert(chunk);
      if (error) {
        failed = error;
        break;
      }
    }
    if (!failed) return { skipped: false, reason: null, omitted: [...omit] };
    if (isMissingTableError(failed.message)) return { skipped: true, reason: failed.message, omitted: [...omit] };
    const m = MISSING_COL_RE.exec(failed.message);
    if (!m || omit.has(m[1])) throw failed;
    omit.add(m[1]);
    await sb.from(table).delete().gte('nc_number', 0);
  }
}

const lookup = loadTenancyLookup(DEFAULT_TENANCY_CSV);
const hmRows = await fetchAll(HM_TABLE).catch(() => []);

const hmByNc = new Map();
for (const hm of hmRows) {
  for (const nc of ncFromHmRow(hm)) {
    if (!hmByNc.has(nc)) hmByNc.set(nc, []);
    hmByNc.get(nc).push(hm);
  }
}

const out = [];
for (const tenancy of lookup.rows || []) {
  const ncRaw = clean(tenancy.NC);
  if (!ncRaw || !/^\d+$/.test(ncRaw)) continue;
  const nc = Number(ncRaw);
  const contractId = clean(tenancy['Contract ID']);
  if (!contractId) continue;

  const { hm, method } = bestHmForTenancy(hmByNc, hmRows, tenancy, nc);
  const tName = nameFromTenancy(tenancy['Tenant Name']);
  const tenantDoc = splitPipeField(tenancy['Tenant ID'])[0] || null;
  const st = clean(tenancy['Tenancy Status']);

  out.push({
    nc_number: nc,
    nc_code: `NC_${String(nc).padStart(4, '0')}`,
    tenancy_contract_id: contractId,
    tenancy_status: st || null,
    cancellation_reason: clean(tenancy['Cancellation Reason']) || null,
    lifecycle_label: lifecycleLabel(tenancy),
    lifecycle_flags: lifecycleFlags(tenancy).join('|'),
    is_occupied: st === 'Occupied',
    check_in_date: parseDdMmYyyy(tenancy['Contract Start Date']),
    check_out_date: parseDdMmYyyy(tenancy['Contract End Date']),
    move_out_date: parseDdMmYyyy(tenancy['Move out date']),
    allocated_room_number: normalizeRoom(tenancy.Door),
    unit_category: clean(tenancy['Unit Category']) || null,
    property_name: clean(tenancy.Property) || null,
    monthly_rent: clean(tenancy['Tenant Rent']) || null,
    deposit_amount: clean(tenancy.Deposit) || null,
    contract_type: clean(tenancy['Contract Type']) || null,
    tenancy_tenant_name: clean(tenancy['Tenant Name']) || null,
    tenancy_tenant_id: clean(tenancy['Tenant ID']) || null,
    tenancy_tenant_email: clean(tenancy['Tenant Email']) || null,
    tenancy_tenant_phone: clean(tenancy['Tenant Phone Number']) || null,
    guest_first_name: firstNonEmpty(hm?.['First Name'], tName.first),
    guest_last_name: firstNonEmpty(hm?.['Last Name(*)'], tName.last),
    guest_second_last_name: clean(hm?.['Second Last Name']) || null,
    guest_document_number: firstNonEmpty(hm?.['Document Number'], tenantDoc),
    guest_document_type: clean(hm?.['Document Type']) || null,
    guest_email: firstNonEmpty(hm?.Email, pickTenancyEmail(tenancy['Tenant Email'])),
    guest_telephone: firstNonEmpty(hm?.Telephone, tenancy['Tenant Phone Number']),
    guest_address_line_1: clean(hm?.['Address Line 1']) || null,
    guest_address_line_2: clean(hm?.['Address Line 2']) || null,
    guest_city: clean(hm?.City) || null,
    guest_postal_code: clean(hm?.['Postal Code']) || null,
    guest_country_code: clean(hm?.['Country Code']) || null,
    guest_nationality_code: clean(hm?.['Nationality Code']) || null,
    housemonk_final_id: hm?.id || null,
    housemonk_match_method: method,
    housemonk_group_code: clean(hm?.['Group Code']) || null,
    housemonk_snapshot: hmSnapshot(hm),
    same_guest_has_occupied_stay: false,
    matching_occupied_contract_id: null,
  });
}

out.sort((a, b) => a.nc_number - b.nc_number || a.tenancy_contract_id.localeCompare(b.tenancy_contract_id));

const seenContract = new Set();
const deduped = [];
let duplicateRowsDropped = 0;
for (const row of out) {
  if (seenContract.has(row.tenancy_contract_id)) {
    duplicateRowsDropped++;
    continue;
  }
  seenContract.add(row.tenancy_contract_id);
  deduped.push(row);
}

const currentFuture = deduped.filter(isCurrentOrFutureReservation);
const removedPastCheckout = deduped.length - currentFuture.length;

const occupiedByGuestKey = new Map();
for (const row of currentFuture) {
  if (!row.is_occupied) continue;
  for (const key of guestMatchKeys(row)) {
    if (!occupiedByGuestKey.has(key)) occupiedByGuestKey.set(key, row.tenancy_contract_id);
  }
}

const filtered = [];
let removedShiftedSuperseded = 0;
for (const row of currentFuture) {
  if (row.tenancy_status !== 'Shifted') {
    filtered.push(row);
    continue;
  }
  let matchContract = null;
  for (const key of guestMatchKeys(row)) {
    const cid = occupiedByGuestKey.get(key);
    if (cid && cid !== row.tenancy_contract_id) {
      matchContract = cid;
      break;
    }
  }
  if (matchContract) {
    removedShiftedSuperseded++;
    continue;
  }
  filtered.push({
    ...row,
    same_guest_has_occupied_stay: false,
    lifecycle_flags: `${row.lifecycle_flags}|shifted_no_parallel_occupied`.replace(/^\|/, ''),
  });
}

const upload = await replaceTable(TABLE, filtered);

const seedPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contract-analysis',
  'supabase-housemonk-tenancy-lifecycle-nc-seed-14-10-2026.sql',
);
if (upload.skipped && filtered.length) writeSeedSql(TABLE, filtered, seedPath);

const byStatus = {};
for (const r of filtered) {
  const k = r.tenancy_status || '(blank)';
  byStatus[k] = (byStatus[k] || 0) + 1;
}

const summary = {
  table: TABLE,
  minDepartureDate: MIN_DEPARTURE_DATE,
  tenancySource: DEFAULT_TENANCY_CSV,
  housemonkTable: HM_TABLE,
  rowCountBeforeFilters: deduped.length,
  rowCount: filtered.length,
  duplicateRowsDropped,
  removedPastCheckout,
  removedShiftedSupersededByOccupied: removedShiftedSuperseded,
  withHousemonkMatch: filtered.filter((r) => r.housemonk_final_id).length,
  occupiedCount: filtered.filter((r) => r.is_occupied).length,
  nonOccupiedCount: filtered.filter((r) => !r.is_occupied).length,
  shiftedKeptWithoutOccupied: filtered.filter((r) => r.tenancy_status === 'Shifted').length,
  withCancellationReason: filtered.filter((r) => r.cancellation_reason).length,
  byTenancyStatus: byStatus,
  upload,
  seedSql: upload.skipped ? seedPath : null,
  ddl: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'contract-analysis',
    'supabase-housemonk-tenancy-lifecycle-nc-14-10-2026.sql',
  ),
};

const summaryPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'housemonk-tenancy-lifecycle-upload-summary.json');
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
