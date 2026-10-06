import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_ALLOWLIST_CSV = path.join(
  here,
  'Contracts reviewed before 31.07.2026 - Sheet1.csv',
);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** @returns {string | null} numeric NC without leading zeros, e.g. "49" */
export function ncNumberFromToken(token) {
  const match = String(token || '').match(/NC[_\s-]*(\d+)/i);
  if (!match) return null;
  const number = parseInt(match[1], 10);
  return Number.isFinite(number) ? String(number) : null;
}

/** Every NC token in a Drive file or folder name. */
export function ncNumbersInName(name) {
  const found = new Set();
  const re = /NC[_\s-]*(\d+)/gi;
  let match = re.exec(String(name || ''));
  while (match) {
    const number = parseInt(match[1], 10);
    if (Number.isFinite(number)) found.add(String(number));
    match = re.exec(String(name || ''));
  }
  return [...found];
}

/**
 * Unique codes from column B. NC_0049 allows a folder whose name contains that code.
 * NC_0001 is not included unless column B also lists NC_0001.
 * @returns {Set<string>}
 */
export function allowedNcNumbersFromCsv(csvText) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex((row) => (row[1] || '').trim().toLowerCase() === 'unique code');
  const dataRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  const allowed = new Set();
  for (const row of dataRows) {
    const nc = ncNumberFromToken(row[1]);
    if (nc) allowed.add(nc);
  }
  return allowed;
}

export function loadAllowedNcNumbers(csvPath = process.env.NC_ALLOWLIST_CSV || DEFAULT_ALLOWLIST_CSV) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`NC allowlist CSV not found: ${csvPath}`);
  }
  return allowedNcNumbersFromCsv(fs.readFileSync(csvPath, 'utf8'));
}

export function nameMatchesAllowlist(name, allowlist) {
  return ncNumbersInName(name).some((nc) => allowlist.has(nc));
}
