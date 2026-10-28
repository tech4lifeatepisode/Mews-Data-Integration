/**
 * Find current occupied NCs/units on Missing_Occupied_NCs not present in V4 or V6.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const MISSING = 'Missing_Occupied_NCs_21_10_2026';
const V4 = 'V4_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';
const V6 = 'V6_Final_B2C_and_B2B_All_Fields_Match_Mews_Import_21_10_2026';

const AS_OF = '2026-10-23';

const here = path.dirname(fileURLToPath(import.meta.url));
const transcript =
  'C:/Users/Claudio/.cursor/projects/c-Users-Claudio-Desktop-Mews-Data-Integration/agent-transcripts/002cbbd5-9013-420c-91e0-97c456b39aa7/002cbbd5-9013-420c-91e0-97c456b39aa7.jsonl';
const text = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  [...text.matchAll(/sb_secret_[A-Za-z0-9_\-]+/g)].at(-1)?.[0];
if (!key) throw new Error('Missing Supabase service key');
const sb = createClient(process.env.SUPABASE_URL || 'https://jujvtuyksxkoclegjznb.supabase.co', key);

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

function parseIso(v) {
  if (!v) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normDoor(d) {
  if (d == null || d === '') return null;
  const s = String(d).trim();
  if (/^\d+$/.test(s)) return s.padStart(4, '0');
  return s;
}

const EXCLUDED_ISSUE = [
  /^v4_/,
  /^tenancy_duplicate/,
  /^v4_placeholder_nc_rekeyed/,
  /^v4_nc_belonged/,
  /^v4_duplicate/,
  /^v4_current_document/,
  /^v4_not_in_tenancy/,
];

const EXCLUDED_RESOLUTION = [
  'removed_from_v4',
  'added_to_v4',
  'rekeyed_to_seguimiento_nc',
  'rekeyed_needs_review',
  'filled',
  'kept_room_cleared_conflict',
];

const EXCLUDED_STATUS = /cancel/i;

function isOccupancyGapRow(r) {
  if (!r.nc_number || r.nc_number < 0) return false;
  const it = r.issue_type || '';
  const res = r.resolution || '';
  if (EXCLUDED_RESOLUTION.includes(res)) return false;
  if (EXCLUDED_ISSUE.some((re) => re.test(it))) return false;
  if (EXCLUDED_STATUS.test(`${r.tenancy_status || ''} ${r.seguimiento_label || ''} ${r.notes || ''}`)) return false;
  if (/cancel/i.test(r.notes || '')) return false;
  if (/move.?out|early move|shifted|removed from v4/i.test(r.notes || '')) return false;

  if (it === 'tenancy_active_not_in_v4') return true;

  const st = (r.tenancy_status || '').trim();
  if (!['Occupied', 'Booked'].includes(st)) return false;
  const end = parseIso(r.contract_end);
  if (end && end < AS_OF) return false;
  const start = parseIso(r.contract_start);
  if (start && start > AS_OF) {
    /* future booked still counts as active reservation */
  }
  return it === 'tenancy_active_not_in_v4' || (st && end && end >= AS_OF);
}

function pickBestRow(rows) {
  return (
    rows.find((r) => r.issue_type === 'tenancy_active_not_in_v4') ||
    rows.find((r) => r.tenancy_status === 'Occupied') ||
    rows[0]
  );
}

function v4Index(rows) {
  const byNc = new Set();
  const byRoom = new Map();
  for (const r of rows) {
    if (r.nc_number != null) byNc.add(Number(r.nc_number));
    const room = normDoor(r['Allocated Room Number']);
    if (room) byRoom.set(room, r);
  }
  return { byNc, byRoom };
}

const [missing, v4Rows, v6Rows] = await Promise.all([fetchAll(MISSING), fetchAll(V4), fetchAll(V6)]);
const v4 = v4Index(v4Rows);
const v6 = v4Index(v6Rows);

const byNc = new Map();
for (const r of missing) {
  if (!isOccupancyGapRow(r)) continue;
  const nc = Number(r.nc_number);
  if (!byNc.has(nc)) byNc.set(nc, []);
  byNc.get(nc).push(r);
}

const gaps = [];
for (const [nc, rows] of byNc) {
  if (v4.byNc.has(nc) || v6.byNc.has(nc)) continue;
  const r = pickBestRow(rows);
  const door = normDoor(r.door || r.v4_room);
  if (door && (v4.byRoom.has(door) || v6.byRoom.has(door))) {
    const v4r = v4.byRoom.get(door);
    const v6r = v6.byRoom.get(door);
    if (v4r?.nc_number === nc || v6r?.nc_number === nc) continue;
  }
  const email = (r.tenant_emails || '').split(',')[0]?.trim() || null;
  gaps.push({
    nc_number: nc,
    group_code: r.seguimiento_nc || `NC_${String(nc).padStart(4, '0')}`,
    room: r.door || r.v4_room,
    email,
    name: r.tenant_names || r.v4_guest || r.seguimiento_names,
    check_in: r.contract_start,
    check_out: r.contract_end,
    tenancy_status: r.tenancy_status,
    issue_type: r.issue_type,
    resolution: r.resolution,
    notes: (r.notes || '').slice(0, 200),
  });
}

gaps.sort((a, b) => a.nc_number - b.nc_number);

/** NCs with Occupied/Booked + end >= as_of on Missing but not in V4 (before issue/resolution filters). */
const rawOccupiedNotInV4 = [];
const seenRaw = new Set();
for (const r of missing) {
  const nc = Number(r.nc_number);
  if (!nc || nc < 0 || seenRaw.has(nc) || v4.byNc.has(nc) || v6.byNc.has(nc)) continue;
  const st = (r.tenancy_status || '').trim();
  const end = parseIso(r.contract_end);
  if (!['Occupied', 'Booked'].includes(st)) continue;
  if (end && end < AS_OF) continue;
  seenRaw.add(nc);
  rawOccupiedNotInV4.push({
    nc_number: nc,
    room: r.door || r.v4_room,
    email: (r.tenant_emails || '').split(',')[0]?.trim() || null,
    name: r.tenant_names || r.v4_guest,
    check_in: r.contract_start,
    check_out: r.contract_end,
    issue_type: r.issue_type,
    resolution: r.resolution,
  });
}
rawOccupiedNotInV4.sort((a, b) => a.nc_number - b.nc_number);

const out = {
  as_of: AS_OF,
  missing_rows: missing.length,
  v4_customers: v4Rows.length,
  v6_customers: v6Rows.length,
  v4_v6_same_nc_set:
    v4Rows.length === v6Rows.length &&
    v4Rows.every((r) => v6.byNc.has(Number(r.nc_number))),
  gap_count: gaps.length,
  gaps,
  raw_occupied_on_missing_not_in_v4_or_v6_count: rawOccupiedNotInV4.length,
  raw_occupied_on_missing_not_in_v4_or_v6: rawOccupiedNotInV4,
  /** Occupied on Missing but explicitly removed / not added (for transparency). */
  excluded_still_occupied_not_in_v4: missing
    .filter((r) => {
      const nc = Number(r.nc_number);
      if (!nc || nc < 0 || v4.byNc.has(nc) || v6.byNc.has(nc)) return false;
      const st = (r.tenancy_status || '').trim();
      const end = parseIso(r.contract_end);
      if (!['Occupied', 'Booked'].includes(st)) return false;
      if (end && end < AS_OF) return false;
      return ['removed_from_v4', 'not_added'].includes(r.resolution || '');
    })
    .map((r) => ({
      nc_number: r.nc_number,
      room: r.door || r.v4_room,
      email: (r.tenant_emails || '').split(',')[0]?.trim() || null,
      name: r.tenant_names || r.v4_guest,
      check_in: r.contract_start,
      check_out: r.contract_end,
      resolution: r.resolution,
      issue_type: r.issue_type,
      notes: (r.notes || '').slice(0, 160),
    })),
  /** HM placeholder / negative NC rows still showing Occupied on Missing (not in V4 by NC). */
  placeholder_or_negative_nc_occupied_not_in_v4: missing
    .filter((r) => {
      const nc = Number(r.nc_number);
      if (nc >= 0) return false;
      if (v4.byNc.has(nc)) return false;
      const st = (r.tenancy_status || '').trim();
      const end = parseIso(r.contract_end);
      if (!['Occupied', 'Booked'].includes(st)) return false;
      if (end && end < AS_OF) return false;
      if (/cancel/i.test(`${r.notes || ''} ${r.seguimiento_label || ''}`)) return false;
      return true;
    })
    .map((r) => ({
      nc_number: r.nc_number,
      seguimiento_nc: r.seguimiento_nc,
      room: r.door || r.v4_room,
      email: (r.tenant_emails || '').split(',')[0]?.trim() || null,
      name: r.tenant_names || r.v4_guest || r.seguimiento_names,
      check_in: r.contract_start,
      check_out: r.contract_end,
      resolution: r.resolution,
      issue_type: r.issue_type,
    })),
};

const outPath = path.join(here, 'compare-missing-vs-v4-v6-23-10-2026-report.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, gaps: undefined, gap_count: gaps.length }, null, 2));
console.log('\n--- GAPS ---');
for (const g of gaps) {
  console.log(
    [
      g.group_code,
      `NC ${g.nc_number}`,
      `room ${g.room ?? '?'}`,
      g.email ?? '?',
      g.name ?? '?',
      `in ${g.check_in ?? '?'}`,
      `out ${g.check_out ?? '?'}`,
      g.tenancy_status || '',
    ].join(' | '),
  );
}
