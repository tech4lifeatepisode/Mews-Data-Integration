-- Companies sheet from Mews_import_v2.10.0.xlsx, plus storage_path and source_document.
-- Table name uses underscores. Run this in the Supabase SQL editor if the table is not already there.

create table if not exists public."Companies_Extraction_12_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  storage_path text,
  source_document text,
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

create index if not exists companies_extraction_12_10_2026_name_idx
  on public."Companies_Extraction_12_10_2026" ("Company Name(*)");

alter table public."Companies_Extraction_12_10_2026" enable row level security;
