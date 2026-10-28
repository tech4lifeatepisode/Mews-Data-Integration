-- V5 Mews import — identical copy of V4 companies (no row changes).
-- Source: V4_Final_Companies_Match_Mews_Import_21_10_2026
-- Data: contract-extraction/create-v5-from-v4-21-10-2026.mjs

create table if not exists public."V5_Final_Companies_Match_Mews_Import_21_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "Company Name(*)" text not null,
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

alter table public."V5_Final_Companies_Match_Mews_Import_21_10_2026" enable row level security;
grant select, insert, update, delete on public."V5_Final_Companies_Match_Mews_Import_21_10_2026" to service_role;

create index if not exists v5_final_companies_match_mews_import_21_10_2026_name_idx
  on public."V5_Final_Companies_Match_Mews_Import_21_10_2026" ("Company Name(*)");

create index if not exists v5_final_companies_match_mews_import_21_10_2026_tax_idx
  on public."V5_Final_Companies_Match_Mews_Import_21_10_2026" ("Tax ID Number");

notify pgrst, 'reload schema';
