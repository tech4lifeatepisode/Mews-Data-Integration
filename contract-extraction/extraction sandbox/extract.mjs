/**
 * Local sandbox: read PDF/DOCX/images from ./contracts and append
 * Mews import rows plus an extraction log under ./sandbox outputs.
 */
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '.env') });

const MODEL = process.env.OPENAI_MODEL_DEFAULT || 'gpt-5.2-2025-12-11';
const CONTRACTS_DIR = path.join(here, 'contracts');
const OUTPUT_DIR = path.join(here, 'sandbox outputs');
let CUSTOMERS_CSV = path.join(OUTPUT_DIR, 'mews-customers.csv');
let COMPANIES_CSV = path.join(OUTPUT_DIR, 'mews-companies.csv');
const LOG_CSV = path.join(OUTPUT_DIR, 'extraction-log.csv');

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FILE_TYPES = new Map([
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

export const LOG_HEADERS = [
  'timestamp',
  'document',
  'file_format',
  'file_bytes',
  'status',
  'failure_reason',
  'model',
  'duration_ms',
  'nc_number',
  'guest_name',
  'arrival_date',
  'departure_date',
  'tenancy_days',
  'unit',
  'meal_plan_extracted',
  'parking_extracted',
  'guarantor_extracted',
  'other_guest_count',
  'customer_fields_filled',
  'key_fields_missing',
];

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    first_name: { type: 'string', nullable: true },
    last_name: { type: 'string', nullable: true },
    second_last_name: { type: 'string', nullable: true },
    email: { type: 'string', nullable: true },
    telephone: { type: 'string', nullable: true },
    document_type: {
      type: 'string',
      enum: ['DNI', 'NIE', 'PASAPORTE', 'ID', 'unknown'],
    },
    document_number: { type: 'string', nullable: true },
    address_line_1: { type: 'string', nullable: true },
    address_line_2: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    postal_code: { type: 'string', nullable: true },
    country_code: { type: 'string', nullable: true },
    nationality_code: { type: 'string', nullable: true },
    birth_date: { type: 'string', nullable: true },
    sex: { type: 'string', nullable: true, description: 'Male or Female when stated, otherwise null.' },
    number_of_people: { type: 'integer' },
    other_guests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
        },
        required: ['first_name', 'last_name'],
      },
    },
    unit_type: { type: 'string', nullable: true },
    room_number: { type: 'string', nullable: true },
    establishment: { type: 'string', nullable: true },
    check_in_date: { type: 'string', nullable: true },
    check_out_date: { type: 'string', nullable: true },
    monthly_price_euros: { type: 'string', nullable: true },
    discount_text: { type: 'string', nullable: true },
    deposit_euros: { type: 'string', nullable: true },
    deposit_text: { type: 'string', nullable: true },
    meal_plan_present: { type: 'boolean' },
    meal_plan_name: { type: 'string', nullable: true },
    meal_plan_monthly_price: { type: 'string', nullable: true },
    parking_present: { type: 'boolean' },
    parking_description: { type: 'string', nullable: true },
    parking_monthly_price: { type: 'string', nullable: true },
    included_services_summary: { type: 'string', nullable: true },
    optional_services_summary: { type: 'string', nullable: true },
    has_guarantor: { type: 'boolean' },
    guarantor_name: { type: 'string', nullable: true },
    guarantor_id_number: { type: 'string', nullable: true },
    company_name: { type: 'string', nullable: true },
    company_tax_id: { type: 'string', nullable: true },
    company_address: { type: 'string', nullable: true },
    company_email: { type: 'string', nullable: true },
  },
  required: [
    'first_name',
    'last_name',
    'second_last_name',
    'email',
    'telephone',
    'document_type',
    'document_number',
    'address_line_1',
    'address_line_2',
    'city',
    'postal_code',
    'country_code',
    'nationality_code',
    'birth_date',
    'sex',
    'number_of_people',
    'other_guests',
    'unit_type',
    'room_number',
    'establishment',
    'check_in_date',
    'check_out_date',
    'monthly_price_euros',
    'discount_text',
    'deposit_euros',
    'deposit_text',
    'meal_plan_present',
    'meal_plan_name',
    'meal_plan_monthly_price',
    'parking_present',
    'parking_description',
    'parking_monthly_price',
    'included_services_summary',
    'optional_services_summary',
    'has_guarantor',
    'guarantor_name',
    'guarantor_id_number',
    'company_name',
    'company_tax_id',
    'company_address',
    'company_email',
  ],
};

function escapeCsvCell(cell) {
  const s = cell == null ? '' : String(cell);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvLine(values) {
  return values.map(escapeCsvCell).join(',');
}

function blankRow(headers) {
  return Object.fromEntries(headers.map((header) => [header, '']));
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

function isSupported(fileName) {
  return mimeFromName(fileName) != null;
}

export function prepareFileInput(fileBuffer, mimeType, filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const base64 = fileBuffer.toString('base64');
  // #region agent log
  fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',hypothesisId:'A',location:'extract.mjs:prepareFileInput',message:'base64 payload allocated',data:{bufferBytes:fileBuffer.length,base64Chars:base64.length,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
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

function text(value) {
  if (value == null) return '';
  const cleaned = String(value).trim();
  if (/^\/?null\/?$/i.test(cleaned) || cleaned.toLowerCase() === 'none') return '';
  return cleaned;
}

function mewsDocumentType(raw) {
  if (raw === 'PASAPORTE') return 'Passport';
  if (raw === 'DNI' || raw === 'NIE' || raw === 'ID') return 'IdentityCard';
  return '';
}

function daysBetween(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '';
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return '';
  return String(Math.round(ms / 86400000));
}

function productLine(label, name, price) {
  const title = text(name);
  if (!title) return '';
  const amount = text(price);
  return amount ? `${label}: ${title} (${amount})` : `${label}: ${title}`;
}

function buildReservationNotes(parsed, tenancyDays) {
  const lines = [];
  if (tenancyDays) lines.push(`Tenancy length: ${tenancyDays} days`);
  if (text(parsed.establishment)) lines.push(`Establishment: ${text(parsed.establishment)}`);
  if (text(parsed.monthly_price_euros)) lines.push(`Monthly price: ${text(parsed.monthly_price_euros)} EUR`);
  if (text(parsed.discount_text)) lines.push(`Discount: ${text(parsed.discount_text)}`);
  if (text(parsed.deposit_euros) || text(parsed.deposit_text)) {
    lines.push(
      `Deposit: ${[text(parsed.deposit_euros) && `${text(parsed.deposit_euros)} EUR`, text(parsed.deposit_text)].filter(Boolean).join(' — ')}`,
    );
  }
  lines.push(
    parsed.has_guarantor
      ? `Guarantor: ${[text(parsed.guarantor_name) || 'yes', text(parsed.guarantor_id_number)].filter(Boolean).join(', ')}`
      : 'Guarantor: no',
  );
  lines.push(parsed.meal_plan_present ? `Meal plan: ${text(parsed.meal_plan_name) || 'yes'}` : 'Meal plan: no');
  lines.push(parsed.parking_present ? `Parking: ${text(parsed.parking_description) || 'yes'}` : 'Parking: no');
  if (text(parsed.included_services_summary)) {
    lines.push(`Included services: ${text(parsed.included_services_summary)}`);
  }
  if (text(parsed.optional_services_summary)) {
    lines.push(`Optional services: ${text(parsed.optional_services_summary)}`);
  }
  return lines.join(' | ');
}

export function toCustomerRow(parsed, fileName) {
  const row = blankRow(CUSTOMER_HEADERS);
  const people = Math.max(1, Number(parsed.number_of_people) || 1);
  const companions = (Array.isArray(parsed.other_guests) ? parsed.other_guests : [])
    .map((guest) => [text(guest.first_name), text(guest.last_name)].filter(Boolean).join(' '))
    .filter(Boolean);
  const tenancyDays = daysBetween(text(parsed.check_in_date), text(parsed.check_out_date));
  const products = [
    parsed.meal_plan_present ? productLine('Meal plan', parsed.meal_plan_name, parsed.meal_plan_monthly_price) : '',
    parsed.parking_present ? productLine('Parking', parsed.parking_description, parsed.parking_monthly_price) : '',
  ].filter(Boolean);
  const nc = ncFromFileName(fileName);

  row.Email = text(parsed.email);
  row['Last Name(*)'] = text(parsed.last_name);
  row['First Name'] = text(parsed.first_name);
  row['Second Last Name'] = text(parsed.second_last_name);
  row.Sex = text(parsed.sex);
  row['Nationality Code'] = text(parsed.nationality_code);
  row['Birth Date'] = text(parsed.birth_date);
  row.Telephone = text(parsed.telephone);
  row['Document Type'] = mewsDocumentType(parsed.document_type);
  row['Document Number'] = text(parsed.document_number);
  row['Address Line 1'] = text(parsed.address_line_1);
  row['Address Line 2'] = text(parsed.address_line_2);
  row.City = text(parsed.city);
  row['Postal Code'] = text(parsed.postal_code);
  row['Country Code'] = text(parsed.country_code);
  row['Internal Guest Notes'] = nc ? `NC_${nc}` : '';
  row['Company Id'] = text(parsed.company_name);
  row['Arrival Date(*)'] = text(parsed.check_in_date);
  row['Departure Date(*)'] = text(parsed.check_out_date);
  row['Person Counts(*)'] = String(people);
  row['Adult Count(*)'] = String(people);
  row['Child Count(*)'] = '0';
  row.Companions = companions.join('; ');
  row['Reservation Notes'] = buildReservationNotes(parsed, tenancyDays);
  row['Group Code'] = nc ? `NC_${nc}` : '';
  row['Currency Code'] = 'EUR';
  row['Allocated Rate'] = text(parsed.monthly_price_euros);
  row['Prepaid Amount'] = text(parsed.deposit_euros);
  row['Allocated Room Category(*)'] = text(parsed.unit_type);
  row['Allocated Room Number'] = text(parsed.room_number);
  row['Included Products'] = products.join('; ');
  row['Partner Company'] = text(parsed.company_name);
  row.Source = 'extraction sandbox';
  row['Channel number'] = path.basename(fileName);
  return { row, tenancyDays, companions };
}

export function toCompanyRow(parsed) {
  if (!text(parsed.company_name)) return null;
  const row = blankRow(COMPANY_HEADERS);
  row['Company Name(*)'] = text(parsed.company_name);
  row['Contact Person'] = [text(parsed.first_name), text(parsed.last_name), text(parsed.second_last_name)]
    .filter(Boolean)
    .join(' ');
  row['Address Line 1'] = text(parsed.company_address);
  row['Tax ID Number'] = text(parsed.company_tax_id);
  row['Invoicing Email'] = text(parsed.company_email);
  row.Notes = 'Extracted from contract';
  return row;
}

export function filledCount(row) {
  return Object.values(row).filter((value) => text(value)).length;
}

export function missingKeyFields(row, parsed) {
  const missing = [];
  if (!row['Last Name(*)']) missing.push('Last Name');
  if (!row['First Name']) missing.push('First Name');
  if (!row['Arrival Date(*)']) missing.push('Arrival Date');
  if (!row['Departure Date(*)']) missing.push('Departure Date');
  if (!row['Allocated Room Category(*)']) missing.push('Unit');
  return missing.join('; ');
}

async function useUnlockedCopy(filePath) {
  try {
    const handle = await fs.open(filePath, 'a');
    await handle.close();
    return filePath;
  } catch (error) {
    if (error?.code !== 'EBUSY') throw error;
    const alt = filePath.replace(/\.csv$/i, '-latest.csv');
    try {
      await fs.access(alt);
    } catch {
      const existing = await fs.readFile(filePath);
      await fs.writeFile(alt, existing);
    }
    console.log(`File is open elsewhere, writing ${path.basename(alt)} instead.`);
    return alt;
  }
}

async function successfulDocuments() {
  try {
    const text = await fs.readFile(LOG_CSV, 'utf8');
    const done = new Set();
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1)) {
      if (!line) continue;
      const cols = line.split(',');
      if (cols[4] === 'success' && cols[1]) done.add(cols[1]);
    }
    return done;
  } catch {
    return new Set();
  }
}

async function ensureCsv(filePath, headers) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, `\uFEFF${toCsvLine(headers)}\r\n`, 'utf8');
  }
}

async function appendCsv(filePath, headers, row) {
  await ensureCsv(filePath, headers);
  const values = headers.map((header) => row[header] ?? '');
  await fs.appendFile(filePath, `${toCsvLine(values)}\r\n`, 'utf8');
}

export async function extractContract(client, fileName, fileBuffer, mimeType) {
  const instructions = `Extract a Spanish NODE / Episode lodging contract into the JSON schema. Use only text in the document. Use null when a value is absent. Do not guess.

Primary sources:
1) The party after "De otra parte," (name, DNI/NIE/pasaporte, domicilio). Split the personal name into first_name, last_name, and second_last_name. Example: "Fausto Marcet Domenech" → first_name Fausto, last_name Marcet, second_last_name Domenech.
2) Anexo I Condiciones Particulares:
   a) Establecimiento
   b) Tipo de unidad alojativa → unit_type
   c) Servicios incluidos → included_services_summary (gym, coworking, pool, cleaning, utilities). This is not a meal plan.
   d) Nº de personas → number_of_people. If missing, use 1.
   e) Duración de la estancia: Fecha de entrada → check_in_date, Fecha de salida → check_out_date, both YYYY-MM-DD.
   f) Precio → monthly_price_euros as digits and a decimal point only, for example 865.00.
   g) Descuento → discount_text
   h) Forma de pago, only if it changes the amounts above
   i) Depósito → deposit_euros and a short deposit_text
   j) Servicios opcionales, including Pensión / meal plan and parking / plaza de garaje when the customer actually contracts them.

Meal plan: meal_plan_present is true only when a Pensión or meal plan is contracted, not merely listed as available. parking_present is true only when parking is contracted.
Other people staying (not the guarantor) go in other_guests. If the contract names an avalista or guarantor, has_guarantor is true and guarantor_name is that person. A company tenant goes in company_name; otherwise company_name is null.
country_code and nationality_code are ISO 3166-1 alpha-2 when the country is known.
Dates that are a constancia de depósito without a departure date: check_out_date = null.`;

  const response = await client.responses.parse({
    model: MODEL,
    temperature: 0,
    max_output_tokens: 4000,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${instructions}\n\nFile name: ${fileName}` },
          prepareFileInput(fileBuffer, mimeType, fileName),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'mews_contract_extraction',
        strict: true,
        schema: EXTRACTION_SCHEMA,
      },
    },
  });

  if (response.output_parsed) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);
  throw new Error('Model returned no extraction JSON');
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in extraction sandbox/.env');
    process.exit(1);
  }

  await fs.mkdir(CONTRACTS_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  CUSTOMERS_CSV = await useUnlockedCopy(CUSTOMERS_CSV);
  COMPANIES_CSV = await useUnlockedCopy(COMPANIES_CSV);
  await ensureCsv(CUSTOMERS_CSV, CUSTOMER_HEADERS);
  await ensureCsv(COMPANIES_CSV, COMPANY_HEADERS);
  await ensureCsv(LOG_CSV, LOG_HEADERS);

  const done = await successfulDocuments();
  const names = (await fs.readdir(CONTRACTS_DIR))
    .filter((name) => name !== '.gitkeep' && !name.startsWith('~$') && !done.has(name))
    .sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    console.log(`No new contract files in ${CONTRACTS_DIR}. Already extracted files are left as they are.`);
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let ok = 0;
  let failed = 0;

  for (const name of names) {
    const started = Date.now();
    const format = fileFormat(name);
    const fullPath = path.join(CONTRACTS_DIR, name);
    const buffer = await fs.readFile(fullPath);
    const mimeType = mimeFromName(name);
    const baseLog = {
      timestamp: new Date().toISOString(),
      document: name,
      file_format: format,
      file_bytes: String(buffer.length),
      model: MODEL,
      nc_number: ncFromFileName(name),
    };

    if (!mimeType) {
      failed += 1;
      await appendCsv(LOG_CSV, LOG_HEADERS, {
        ...baseLog,
        status: 'failed',
        failure_reason: `Unsupported file type ${path.extname(name) || '(none)'}. Use PDF, DOCX, or an image.`,
        duration_ms: String(Date.now() - started),
        guest_name: '',
        arrival_date: '',
        departure_date: '',
        tenancy_days: '',
        unit: '',
        meal_plan_extracted: '',
        parking_extracted: '',
        guarantor_extracted: '',
        other_guest_count: '',
        customer_fields_filled: '',
        key_fields_missing: '',
      });
      console.error(`FAIL: ${name} — unsupported type`);
      continue;
    }

    try {
      const parsed = await extractContract(client, name, buffer, mimeType);
      const { row, tenancyDays, companions } = toCustomerRow(parsed, name);
      const company = toCompanyRow(parsed);
      await appendCsv(CUSTOMERS_CSV, CUSTOMER_HEADERS, row);
      if (company) await appendCsv(COMPANIES_CSV, COMPANY_HEADERS, company);
      await appendCsv(LOG_CSV, LOG_HEADERS, {
        ...baseLog,
        status: 'success',
        failure_reason: '',
        duration_ms: String(Date.now() - started),
        guest_name: [row['First Name'], row['Last Name(*)'], row['Second Last Name']].filter(Boolean).join(' '),
        arrival_date: row['Arrival Date(*)'],
        departure_date: row['Departure Date(*)'],
        tenancy_days: tenancyDays,
        unit: row['Allocated Room Category(*)'],
        meal_plan_extracted: parsed.meal_plan_present ? 'yes' : 'no',
        parking_extracted: parsed.parking_present ? 'yes' : 'no',
        guarantor_extracted: parsed.has_guarantor ? 'yes' : 'no',
        other_guest_count: String(companions.length),
        customer_fields_filled: String(filledCount(row)),
        key_fields_missing: missingKeyFields(row, parsed),
      });
      ok += 1;
      console.log(`OK: ${name}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await appendCsv(LOG_CSV, LOG_HEADERS, {
        ...baseLog,
        status: 'failed',
        failure_reason: message,
        duration_ms: String(Date.now() - started),
        guest_name: '',
        arrival_date: '',
        departure_date: '',
        tenancy_days: '',
        unit: '',
        meal_plan_extracted: '',
        parking_extracted: '',
        guarantor_extracted: '',
        other_guest_count: '',
        customer_fields_filled: '',
        key_fields_missing: '',
      });
      console.error(`FAIL: ${name} — ${message}`);
    }
  }

  console.log(`Finished. success=${ok} failed=${failed}`);
  console.log(`Customers: ${CUSTOMERS_CSV}`);
  console.log(`Companies: ${COMPANIES_CSV}`);
  console.log(`Log: ${LOG_CSV}`);
}

const isSandboxCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isSandboxCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
