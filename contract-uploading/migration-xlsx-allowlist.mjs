import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { ncNumberFromToken } from './nc-allowlist.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_MIGRATION_XLSX = path.join(here, 'Revisión contratos MEWS migracion (1).xlsx');
export const DEFAULT_MIGRATION_JSON = path.join(here, 'migration-green-nc-allowlist.json');

/** Explicit green fills used in the MEWS migration workbook (column F). */
export const MIGRATION_GREEN_ARGB = new Set([
  'FF6AA84F',
  'FF93C47D',
  'FF00FF00',
  'FFC6EFCE',
  'FF92D050',
  'FF00B050',
  'FF70AD47',
]);

export const MIGRATION_YELLOW_ARGB = new Set(['FFFFFF00', 'FFFF00']);

const ELIGIBLE_CATEGORIES = new Set(['B2C', 'B2B2C']);

function normalizeArgb(fgColor) {
  if (!fgColor) return null;
  const argb = fgColor.argb || fgColor.rgb;
  if (!argb) return null;
  return String(argb).toUpperCase().replace(/^#/, '');
}

/** Excel theme index 9 is accent 6, the default green used on most migration rows. */
const THEME_GREEN_INDEX = 9;

function isGreenFill(cell) {
  const fill = cell?.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern !== 'solid') return false;
  const theme = fill.fgColor?.theme;
  if (theme === THEME_GREEN_INDEX) return true;
  const argb = normalizeArgb(fill.fgColor);
  return Boolean(argb && MIGRATION_GREEN_ARGB.has(argb));
}

function fillLabel(cell) {
  const fill = cell?.fill;
  if (!fill || fill.type !== 'pattern') return null;
  if (fill.fgColor?.theme != null) return `theme:${fill.fgColor.theme}`;
  return normalizeArgb(fill.fgColor);
}

function ncFromRow(row) {
  const fromB = ncNumberFromToken(row.getCell(2).value);
  if (fromB) return fromB;
  const fromA = row.getCell(1).value;
  if (fromA != null && String(fromA).trim().match(/^\d+$/)) {
    return String(parseInt(String(fromA).trim(), 10));
  }
  return ncNumberFromToken(fromA);
}

/**
 * Rows with green column F and Category B2C or B2B2C.
 * @returns {{ allowlist: Set<string>, rows: Array<{ nc: string, row: number, category: string, argb: string }> }}
 */
export async function migrationGreenAllowlistFromXlsx(xlsxPath = process.env.MIGRATION_XLSX_PATH || DEFAULT_MIGRATION_XLSX) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Migration workbook not found: ${xlsxPath}`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Migration workbook has no sheets');

  const allowlist = new Set();
  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const category = String(row.getCell(3).value ?? '')
      .trim()
      .toUpperCase();
    if (!ELIGIBLE_CATEGORIES.has(category)) return;

    const cellF = row.getCell(6);
    if (!isGreenFill(cellF)) return;

    const nc = ncFromRow(row);
    if (!nc) return;

    allowlist.add(nc);
    rows.push({ nc, row: rowNumber, category, argb: fillLabel(cellF) });
  });

  return { allowlist, rows, xlsxPath, sheetName: sheet.name };
}

export async function loadMigrationGreenNcNumbers(xlsxPath) {
  const { allowlist } = await migrationGreenAllowlistFromXlsx(xlsxPath);
  return allowlist;
}

function allowlistFromJson(jsonPath = process.env.MIGRATION_ALLOWLIST_JSON || DEFAULT_MIGRATION_JSON) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `Migration workbook not found and no JSON fallback at ${jsonPath}. Set MIGRATION_XLSX_PATH or commit migration-green-nc-allowlist.json.`,
    );
  }
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const list = parsed.nc_numbers || parsed.allowlist || [];
  const allowlist = new Set();
  for (const entry of list) {
    const nc = ncNumberFromToken(entry) || (String(entry).match(/^\d+$/) ? String(parseInt(entry, 10)) : null);
    if (nc) allowlist.add(nc);
  }
  return {
    allowlist,
    rows: list.map((nc) => ({ nc: String(nc), row: null, category: null, argb: null })),
    xlsxPath: null,
    jsonPath,
    sheetName: null,
  };
}

/** Prefer live xlsx when present; otherwise checked-in JSON list (for Render). */
export async function resolveMigrationGreenAllowlist(xlsxPath = process.env.MIGRATION_XLSX_PATH || DEFAULT_MIGRATION_XLSX) {
  if (fs.existsSync(xlsxPath)) {
    return migrationGreenAllowlistFromXlsx(xlsxPath);
  }
  return allowlistFromJson();
}
