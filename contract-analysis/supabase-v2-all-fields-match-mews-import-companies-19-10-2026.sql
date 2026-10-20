-- V2 Mews import (Companies) — same shape as 19_10 companies table.
-- Data: contract-extraction/upload-v2-mews-import-19-10-2026.mjs

create table if not exists public."V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nc_number integer not null,
  "Company Name(*)" text,
  "Telephone" text,
  "Contact Person" text,
  "Contact Notes" text,
  "Website" text,
  "Notes" text,
  "Department" text,
  "Address Line 1" text,
  "Address Line 2" text,
  "City" text,
  "Postal Code" text,
  "Country Code" text,
  "Mother Company Id" text,
  "Reference ID" text,
  "Fiscal Identifier" text,
  "Tax ID Number" text,
  "Additional Tax Identifier" text,
  "Accounting Code" text,
  "Billing Code" text,
  "External Identifier" text,
  "Invoice Due Interval" text,
  "Invoicing Email" text,
  "Invoiceable" text,
  "Add Fees To Invoices" text,
  "Add Tax Deducted Payment To Invoices" text,
  "IATA" text,
  "DUNS Number" text,
  "Cod. destinatario" text,
  "Fiscal code" text,
  "Tender Code (CIG)" text,
  "Project Code (CUP)" text
);

alter table public."V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026" enable row level security;
grant select, insert, update, delete on public."V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026" to service_role;

create unique index if not exists v2_final_format_all_fields_match_mews_import_companies_19_10_2026_nc_idx
  on public."V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026" (nc_number);

-- Refresh PostgREST schema cache so the upload script can insert immediately after DDL.
notify pgrst, 'reload schema';
