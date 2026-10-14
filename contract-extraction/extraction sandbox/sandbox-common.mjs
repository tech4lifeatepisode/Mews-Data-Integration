/**
 * Shared sandbox pieces for B2C and B2B extraction.
 * Prompts, schemas, and output folders stay in extract.mjs and extract-b2b.mjs.
 */
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });

export const MODEL = process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.2-2025-12-11';
export const SANDBOX_ROOT = here;
export const B2C_CONTRACTS_DIR = path.join(here, 'contracts', 'B2C contracts');
export const B2C_OUTPUT_DIR = path.join(here, 'sandbox outputs', 'B2C extracts');
export const B2B_CONTRACTS_DIR = path.join(here, 'contracts', 'B2B contracts');
export const B2B_OUTPUT_DIR = path.join(here, 'sandbox outputs', 'B2B extracts');

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const FILE_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', DOCX_MIME],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

/** Exact column order from Mews_import_v2.10.0.xlsx → Customers. */
export const CUSTOMER_HEADERS = [
  'Email',
  'Last Name(*)',
  'First Name',
  'Second Last Name',
  'Title',
  'Sex',
  'Nationality Code',
  'Preferred Language Code',
  'Birth Date',
  'Birth Place',
  'Telephone',
  'Document Type',
  'Document Number',
  'Document Expiry Date',
  'Document Issue Date',
  'Document Issuing Country Code',
  'Document Issuing Country Subdivision Code',
  'Document Issuing City',
  'Document Support Number',
  'Occupation',
  'Car Registration Number',
  'Address Line 1',
  'Address Line 2',
  'City',
  'Postal Code',
  'Country Code',
  'Country Subdivision Code',
  'Customer Classification',
  'Internal Guest Notes',
  'Preferred Space Features',
  'Dietary Requirements',
  'Loyalty Code',
  'Company Id',
  'Tax Identification Number',
  'Accounting Code',
  'Billing Code',
  'Italian Destination Code',
  'Italian Fiscal Code',
  'Italian Lottery Code',
  'Invoiceable',
  'Process ID Image',
  'Process Verification Photo',
  'Send Marketing Emails',
  'Send Marketing Postal Mail',
  'Send Partner Marketing Emails',
  'Send Partner Marketing Postal Mail',
  'Arrival Date(*)',
  'Arrival Time',
  'Departure Date(*)',
  'Departure Time',
  'Person Counts(*)',
  'Adult Count(*)',
  'Child Count(*)',
  'Booker ID',
  'Companions',
  'Reservation Notes',
  'Confirmation Code',
  'Group Code',
  'Voucher Code',
  'Availability Block ID',
  'Currency Code',
  'Total Price',
  'Per Night Prices',
  'Prepaid Amount',
  'Prepayment Type',
  'Skip Automatic Settlement',
  'Allocated Room Category(*)',
  'Allocated Room Number',
  'Allocated Rate',
  'Included Products',
  'Partner Company',
  'Travel Agency',
  'Business Segment',
  'Reservation Purpose',
  'Release Date',
  'Channel manager number',
  'Channel number',
  'Channel manager integration ID',
  'Source',
];

/** Exact column order from Mews_import_v2.10.0.xlsx → Companies. */
export const COMPANY_HEADERS = [
  'Company Name(*)',
  'Telephone',
  'Contact Person',
  'Contact Notes',
  'Website',
  'Notes',
  'Department',
  'Address Line 1',
  'Address Line 2',
  'City',
  'Postal Code',
  'Country Code',
  'Mother Company Id',
  'Reference ID',
  'Fiscal Identifier',
  'Tax ID Number',
  'Additional Tax Identifier',
  'Accounting Code',
  'Billing Code',
  'External Identifier',
  'Invoice Due Interval',
  'Invoicing Email',
  'Invoiceable',
  'Add Fees To Invoices',
  'Add Tax Deducted Payment To Invoices',
  'IATA',
  'DUNS Number',
  'Cod. destinatario',
  'Fiscal code',
  'Tender Code (CIG)',
  'Project Code (CUP)',
];

export function text(value) {
  if (value == null) return '';
  const cleaned = String(value).trim();
  if (/^\/?null\/?$/i.test(cleaned) || cleaned.toLowerCase() === 'none') return '';
  return cleaned;
}

export function blankRow(headers) {
  return Object.fromEntries(headers.map((header) => [header, '']));
}

function escapeCsvCell(cell) {
  const value = cell == null ? '' : String(cell);
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsvLine(values) {
  return values.map(escapeCsvCell).join(',');
}

export async function ensureCsv(filePath, headers) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `\uFEFF${toCsvLine(headers)}\r\n`, 'utf8');
  }
}

export async function appendCsv(filePath, headers, row) {
  await ensureCsv(filePath, headers);
  const values = headers.map((header) => row[header] ?? '');
  await fs.appendFile(filePath, `${toCsvLine(values)}\r\n`, 'utf8');
}

export function ncFromFileName(fileName) {
  const match = path.basename(fileName).match(/NC[_\s-]*(\d+)/i);
  return match ? String(parseInt(match[1], 10)) : '';
}

export function fileFormat(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf' || /_pdf$/i.test(path.basename(fileName))) return 'PDF';
  if (ext === '.docx' || ext === '.doc') return 'DOCX';
  if (FILE_TYPES.has(ext)) return 'Other';
  return 'Other';
}

export function mimeFromName(fileName) {
  const base = path.basename(fileName);
  const ext = path.extname(base).toLowerCase();
  if (FILE_TYPES.has(ext)) return FILE_TYPES.get(ext);
  if (/_pdf$/i.test(base)) return 'application/pdf';
  return null;
}

export function prepareFileInput(fileBuffer, mimeType, filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const base64 = fileBuffer.toString('base64');
  // #region agent log
  fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',hypothesisId:'A',location:'sandbox-common.mjs:prepareFileInput',message:'base64 payload allocated',data:{bufferBytes:fileBuffer.length,base64Chars:base64.length,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (mimeType === 'application/pdf' || mimeType === DOCX_MIME) {
    return {
      type: 'input_file',
      filename: safeName,
      file_data: `data:${mimeType};base64,${base64}`,
    };
  }
  return {
    type: 'input_image',
    detail: 'auto',
    image_url: `data:${mimeType};base64,${base64}`,
  };
}
