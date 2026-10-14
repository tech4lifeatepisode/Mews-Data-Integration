/**
 * B2B sandbox extractor. Reads ./contracts/B2B contracts.
 * One Companies row per partner company. One Customers row per NC, linked
 * through Partner Company. Run with: npm run extract:b2b
 */
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  B2B_CONTRACTS_DIR,
  B2B_OUTPUT_DIR,
  COMPANY_HEADERS,
  CUSTOMER_HEADERS,
  DOCX_MIME,
  MODEL,
  appendCsv,
  blankRow,
  fileFormat,
  mimeFromName,
  prepareFileInput,
  text,
} from './sandbox-common.mjs';

const CONTRACTS_DIR = B2B_CONTRACTS_DIR;
const OUTPUT_DIR = B2B_OUTPUT_DIR;
const COMPANIES_CSV = path.join(OUTPUT_DIR, 'mews-companies.csv');
const CUSTOMERS_CSV = path.join(OUTPUT_DIR, 'mews-customers.csv');
const LOG_CSV = path.join(OUTPUT_DIR, 'extraction-log.csv');

export const B2B_LOG_HEADERS = [
  'timestamp',
  'document',
  'file_format',
  'file_bytes',
  'status',
  'failure_reason',
  'model',
  'duration_ms',
  'nc_numbers',
  'company_name',
  'customer_rows',
];

/** Company fields come only from Anexo II. One extracted object is repeated per NC. */
export const B2B_INSTRUCTIONS = `Extract a Spanish NODE / Episode B2B company lodging contract into the JSON schema. Use only text in the document. Use null when a value is absent. Do not guess. If the PDF is a scan, read the words printed on the pages.

The tenant is the company after "De otra parte" (the Cliente). Do not use the landlord, CHAMARI ITG or "la Empresa", as company_name.

Company identity, from "De otra parte" when Anexo II does not repeat it:
- Razón social → company_name, without a leading colon
- CIF / NIF / VAT → tax_id_number. Put the same identifier in fiscal_identifier only when the contract calls it a fiscal identifier.
- Domicilio social → address_line_1, address_line_2, city, postal_code. country_code is ISO 3166-1 alpha-2 when the country is known.
- Representante → contact_person
- Teléfono → telephone
- Email de facturación → invoicing_email

Anexo II Condiciones Particulares holds the lodging terms:
- Establecimiento → establishment
- Tipo de unidad alojativa → unit_type
- Nº de plazas → number_of_people. If missing, use 1.
- Fecha de entrada → check_in_date, Fecha de salida → check_out_date, both YYYY-MM-DD.
- Precio → monthly_price_euros as digits and a decimal point only, for example 1115.00.
- Depósito → deposit_euros
- Also put those lodging terms in anexo_ii_notes as one short line.

NC numbers:
- Read every NC written in the file name and in the contract.
- A span of two numbers, such as NC_1963-2030 or NC_1963 to NC_2030, is an inclusive range: nc_range_start 1963 and nc_range_end 2030. Do not list every number in between.
- Three or more written numbers, such as NC_1890-1891-1892 or NC_2082_2083_2084_2085, are an explicit list in nc_numbers, not a range from the first to the last.
- A single NC is one entry in nc_numbers, with both range fields null.
- Never use 0 as an NC number.`;

const B2B_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company_name: { type: 'string', nullable: true },
    telephone: { type: 'string', nullable: true },
    contact_person: { type: 'string', nullable: true },
    contact_notes: { type: 'string', nullable: true },
    website: { type: 'string', nullable: true },
    department: { type: 'string', nullable: true },
    address_line_1: { type: 'string', nullable: true },
    address_line_2: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    postal_code: { type: 'string', nullable: true },
    country_code: { type: 'string', nullable: true },
    mother_company: { type: 'string', nullable: true },
    fiscal_identifier: { type: 'string', nullable: true },
    tax_id_number: { type: 'string', nullable: true },
    additional_tax_identifier: { type: 'string', nullable: true },
    accounting_code: { type: 'string', nullable: true },
    billing_code: { type: 'string', nullable: true },
    invoice_due_interval: { type: 'string', nullable: true },
    invoicing_email: { type: 'string', nullable: true },
    anexo_ii_notes: { type: 'string', nullable: true },
    establishment: { type: 'string', nullable: true },
    unit_type: { type: 'string', nullable: true },
    check_in_date: { type: 'string', nullable: true },
    check_out_date: { type: 'string', nullable: true },
    monthly_price_euros: { type: 'string', nullable: true },
    deposit_euros: { type: 'string', nullable: true },
    number_of_people: { type: 'integer' },
    nc_numbers: { type: 'array', items: { type: 'integer' } },
    nc_range_start: { type: 'integer', nullable: true },
    nc_range_end: { type: 'integer', nullable: true },
  },
  required: [
    'company_name',
    'telephone',
    'contact_person',
    'contact_notes',
    'website',
    'department',
    'address_line_1',
    'address_line_2',
    'city',
    'postal_code',
    'country_code',
    'mother_company',
    'fiscal_identifier',
    'tax_id_number',
    'additional_tax_identifier',
    'accounting_code',
    'billing_code',
    'invoice_due_interval',
    'invoicing_email',
    'anexo_ii_notes',
    'establishment',
    'unit_type',
    'check_in_date',
    'check_out_date',
    'monthly_price_euros',
    'deposit_euros',
    'number_of_people',
    'nc_numbers',
    'nc_range_start',
    'nc_range_end',
  ],
};

function field(value) {
  return text(value).replace(/^[:\s]+/, '');
}

/**
 * NC_1963-2030 expands to every integer from 1963 through 2030.
 * NC_1890-1891-1892 and NC_2082_2083_2084_2085 stay as the listed numbers.
 * @param {string} label
 * @returns {number[]}
 */
export function ncsFromLabel(label) {
  const found = new Set();
  const source = String(label || '');
  const groups = source.matchAll(/NC[_\s-]*(\d+(?:\s*[-_–—]\s*\d+)+)/gi);
  for (const group of groups) {
    const numbers = group[1]
      .split(/\s*[-_–—]\s*/)
      .map((part) => Number(part))
      .filter((number) => Number.isInteger(number));
    if (numbers.length === 2 && numbers[1] > numbers[0]) {
      for (let nc = numbers[0]; nc <= numbers[1]; nc += 1) found.add(nc);
    } else {
      for (const number of numbers) found.add(number);
    }
  }
  const proseRanges = source.matchAll(
    /NC[_\s-]*(\d+)\s+(?:to|a|hasta)\s+NC[_\s-]*(\d+)/gi,
  );
  for (const range of proseRanges) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
      for (let nc = start; nc <= end; nc += 1) found.add(nc);
    }
  }
  if (found.size === 0) {
    for (const single of source.matchAll(/NC[_\s-]*(\d+)/gi)) found.add(Number(single[1]));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Filename ranges plus Anexo II ranges and explicit numbers.
 * @param {string} fileName
 * @param {{ nc_numbers?: number[], nc_range_start?: number | null, nc_range_end?: number | null }} parsed
 * @returns {number[]}
 */
export function expandB2bNcs(fileName, parsed) {
  const found = new Set(ncsFromLabel(fileName));
  const start = Number(parsed?.nc_range_start);
  const end = Number(parsed?.nc_range_end);
  if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start && end - start <= 500) {
    for (let nc = start; nc <= end; nc += 1) found.add(nc);
  }
  for (const number of parsed?.nc_numbers || []) {
    if (Number.isInteger(number) && number > 0) found.add(number);
  }
  return [...found].filter((nc) => nc > 0).sort((a, b) => a - b);
}

/** One Companies row for the partner. NC numbers are not repeated here. */
export function toB2bCompanyRow(parsed) {
  const row = blankRow(COMPANY_HEADERS);
  row['Company Name(*)'] = field(parsed.company_name);
  row.Telephone = field(parsed.telephone);
  row['Contact Person'] = field(parsed.contact_person);
  row['Contact Notes'] = field(parsed.contact_notes);
  row.Website = field(parsed.website);
  row.Notes = field(parsed.anexo_ii_notes);
  row.Department = field(parsed.department);
  row['Address Line 1'] = field(parsed.address_line_1);
  row['Address Line 2'] = field(parsed.address_line_2);
  row.City = field(parsed.city);
  row['Postal Code'] = field(parsed.postal_code);
  row['Country Code'] = field(parsed.country_code);
  row['Mother Company Id'] = field(parsed.mother_company);
  row['Fiscal Identifier'] = field(parsed.fiscal_identifier);
  row['Tax ID Number'] = field(parsed.tax_id_number);
  row['Additional Tax Identifier'] = field(parsed.additional_tax_identifier);
  row['Accounting Code'] = field(parsed.accounting_code);
  row['Billing Code'] = field(parsed.billing_code);
  row['Invoice Due Interval'] = field(parsed.invoice_due_interval);
  row['Invoicing Email'] = field(parsed.invoicing_email);
  return row;
}

/** One Customers row per NC. Partner Company and Company Id point at the single company. */
export function toB2bCustomerRows(parsed, fileName) {
  const ncs = expandB2bNcs(fileName, parsed);
  const labels = ncs.length ? ncs.map((nc) => `NC_${nc}`) : [''];
  const company = field(parsed.company_name);
  return labels.map((ncLabel) => {
    const row = blankRow(CUSTOMER_HEADERS);
    row['Last Name(*)'] = company;
    row['Company Id'] = company;
    row['Partner Company'] = company;
    row['Tax Identification Number'] = field(parsed.tax_id_number);
    row['Internal Guest Notes'] = ncLabel;
    row['Group Code'] = ncLabel;
    row['Arrival Date(*)'] = field(parsed.check_in_date);
    row['Departure Date(*)'] = field(parsed.check_out_date);
    row['Person Counts(*)'] = '1';
    row['Adult Count(*)'] = '1';
    row['Child Count(*)'] = '0';
    row['Reservation Notes'] = field(parsed.anexo_ii_notes);
    row['Currency Code'] = 'EUR';
    row['Allocated Rate'] = field(parsed.monthly_price_euros);
    row['Prepaid Amount'] = field(parsed.deposit_euros);
    row['Allocated Room Category(*)'] = field(parsed.unit_type);
    row.Source = 'B2B extraction';
    row['Channel number'] = path.basename(fileName);
    return row;
  });
}

export async function extractB2bContract(client, fileName, fileBuffer, mimeType) {
  const response = await client.responses.parse({
    model: MODEL,
    temperature: 0,
    max_output_tokens: 4000,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${B2B_INSTRUCTIONS}\n\nFile name: ${fileName}` },
          prepareFileInput(fileBuffer, mimeType, fileName),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'mews_b2b_company_extraction',
        strict: true,
        schema: B2B_SCHEMA,
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
  await fs.writeFile(COMPANIES_CSV, `\uFEFF${COMPANY_HEADERS.join(',')}\r\n`, 'utf8');
  await fs.writeFile(CUSTOMERS_CSV, `\uFEFF${CUSTOMER_HEADERS.join(',')}\r\n`, 'utf8');
  await fs.writeFile(LOG_CSV, `\uFEFF${B2B_LOG_HEADERS.join(',')}\r\n`, 'utf8');

  const names = (await fs.readdir(CONTRACTS_DIR))
    .filter((name) => name !== '.gitkeep' && !name.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    console.log(`No B2B contract files in ${CONTRACTS_DIR}.`);
    return;
  }

  const seenCompanies = new Set();
  const seenNcs = new Set();
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5 * 60 * 1000, maxRetries: 0 });
  for (const name of names) {
    const started = Date.now();
    const fullPath = path.join(CONTRACTS_DIR, name);
    const buffer = await fs.readFile(fullPath);
    const mimeType = mimeFromName(name) || (fileFormat(name) === 'PDF' ? 'application/pdf' : DOCX_MIME);
    try {
      const parsed = await extractB2bContract(client, name, buffer, mimeType);
      const companyName = field(parsed.company_name);
      if (!companyName) throw new Error('Company name was not found in the contract.');
      const companyKey = companyName.toLowerCase();
      if (!seenCompanies.has(companyKey)) {
        seenCompanies.add(companyKey);
        await appendCsv(COMPANIES_CSV, COMPANY_HEADERS, toB2bCompanyRow(parsed));
      }
      const customerRows = toB2bCustomerRows(parsed, name).filter((row) => {
        const nc = row['Group Code'];
        if (!nc || seenNcs.has(nc)) return false;
        seenNcs.add(nc);
        return true;
      });
      for (const row of customerRows) await appendCsv(CUSTOMERS_CSV, CUSTOMER_HEADERS, row);
      await appendCsv(LOG_CSV, B2B_LOG_HEADERS, {
        timestamp: new Date().toISOString(),
        document: name,
        file_format: fileFormat(name),
        file_bytes: String(buffer.length),
        status: 'success',
        failure_reason: '',
        model: MODEL,
        duration_ms: String(Date.now() - started),
        nc_numbers: customerRows.map((row) => row['Group Code']).filter(Boolean).join(', '),
        company_name: companyName,
        customer_rows: String(customerRows.length),
      });
      console.log(`OK: ${name} → ${customerRows.length} customer row(s), partner ${companyName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendCsv(LOG_CSV, B2B_LOG_HEADERS, {
        timestamp: new Date().toISOString(),
        document: name,
        file_format: fileFormat(name),
        file_bytes: String(buffer.length),
        status: 'failed',
        failure_reason: message,
        model: MODEL,
        duration_ms: String(Date.now() - started),
        nc_numbers: '',
        company_name: '',
        customer_rows: '0',
      });
      console.error(`FAIL: ${name} — ${message}`);
    }
  }
  console.log(`Customers: ${CUSTOMERS_CSV}`);
  console.log(`Companies: ${COMPANIES_CSV}`);
}

const isB2bCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isB2bCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
