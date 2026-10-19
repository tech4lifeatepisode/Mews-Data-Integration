-- Three-way Final_Format match — DDL only (data via contract-extraction/upload-matching-across-final-format-15-10-2026.mjs)
-- HM excludes Missing_Group_Code cohort. Row counts: match 720, all-fields mews 644, names 1, units 15, dates 64, extras 0, rent 89, deposits 18

-- Drop broken/truncated name from first DDL attempt (PG 63-char identifier limit)
drop table if exists public."Matching_Across_Final_Format_Customers_HM_Seguimiento_15_10_2026" cascade;
drop table if exists public."Matching_Across_Final_Format_Customers_HM_Seguimiento_15_10_202" cascade;

create table if not exists public."Final_Format_Three_Way_Match_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "in_customers" boolean,
  "in_seguimiento" boolean,
  "in_housemonk" boolean,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "name_customers" text,
  "name_seguimiento" text,
  "name_housemonk" text,
  "document_customers" text,
  "document_seguimiento" text,
  "document_housemonk" text,
  "unit_customers" text,
  "unit_seguimiento" text,
  "unit_housemonk" text,
  "arrival_customers" text,
  "arrival_seguimiento" text,
  "arrival_housemonk" text,
  "departure_customers" text,
  "departure_seguimiento" text,
  "departure_housemonk" text,
  "meal_plan_customers" text,
  "meal_plan_seguimiento" text,
  "meal_plan_housemonk" boolean,
  "parking_customers" text,
  "parking_seguimiento" text,
  "parking_housemonk" boolean,
  "rent_customers" text,
  "rent_seguimiento" text,
  "rent_housemonk" text,
  "deposit_customers" boolean,
  "deposit_seguimiento" text,
  "deposit_housemonk" text,
  "names_match" boolean,
  "at_least_one_name_pair_match" boolean,
  "name_pairs_matching_count" integer,
  "matching_name_pairs" text,
  "documents_match" boolean,
  "unit_types_match" boolean,
  "dates_match" boolean,
  "extras_match" boolean,
  "rent_match" boolean,
  "deposits_match" boolean,
  "nc_match" boolean,
  "all_fields_match" boolean,
  "partner_company" boolean,
  "likely_company_label" boolean,
  "companies_match_tier" boolean,
  "matched_company_id" boolean,
  "matched_company_name" boolean,
  "companies_match_signals" boolean
);

alter table public."Final_Format_Three_Way_Match_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Three_Way_Match_15_10_2026" to service_role;

create unique index if not exists final_format_three_way_match_15_10_2026_nc_idx on public."Final_Format_Three_Way_Match_15_10_2026" (nc_number);

delete from public."Final_Format_Three_Way_Match_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Names_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "name_customers" text,
  "name_seguimiento" text,
  "name_housemonk" text,
  "at_least_one_name_pair_match" boolean,
  "name_pairs_matching_count" integer,
  "matching_name_pairs" text,
  "document_customers" text,
  "document_seguimiento" text,
  "document_housemonk" text,
  "partner_company" boolean,
  "likely_company_label" boolean,
  "companies_match_tier" boolean,
  "matched_company_id" boolean,
  "matched_company_name" boolean,
  "companies_match_signals" boolean,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text,
  "extras_customers" text
);

alter table public."Final_Format_Mismatch_Names_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Names_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_names_15_10_2026_nc_idx on public."Final_Format_Mismatch_Names_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Names_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Unit_Types_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "unit_customers" text,
  "unit_seguimiento" text,
  "unit_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);

alter table public."Final_Format_Mismatch_Unit_Types_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Unit_Types_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_unit_types_15_10_2026_nc_idx on public."Final_Format_Mismatch_Unit_Types_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Unit_Types_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Dates_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "arrival_customers" text,
  "arrival_seguimiento" text,
  "arrival_housemonk" text,
  "departure_customers" text,
  "departure_seguimiento" text,
  "departure_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text,
  "extras_customers" text
);

alter table public."Final_Format_Mismatch_Dates_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Dates_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_dates_15_10_2026_nc_idx on public."Final_Format_Mismatch_Dates_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Dates_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Extras_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "meal_plan_customers" text
);

alter table public."Final_Format_Mismatch_Extras_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Extras_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_extras_15_10_2026_nc_idx on public."Final_Format_Mismatch_Extras_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Extras_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Rent_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "rent_customers" text,
  "rent_seguimiento" text,
  "rent_housemonk" boolean,
  "extras_customers" boolean,
  "extras_housemonk" boolean,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" boolean,
  "Acutal Value" text
);

alter table public."Final_Format_Mismatch_Rent_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Rent_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_rent_15_10_2026_nc_idx on public."Final_Format_Mismatch_Rent_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Rent_15_10_2026";

create table if not exists public."Final_Format_Mismatch_Deposits_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "deposit_customers" text,
  "deposit_seguimiento" text,
  "deposit_housemonk" text,
  "extras_customers" boolean,
  "extras_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);

alter table public."Final_Format_Mismatch_Deposits_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Deposits_15_10_2026" to service_role;

create unique index if not exists final_format_mismatch_deposits_15_10_2026_nc_idx on public."Final_Format_Mismatch_Deposits_15_10_2026" (nc_number);

delete from public."Final_Format_Mismatch_Deposits_15_10_2026";

create table if not exists public."Final_Format_All_Fields_Match_Mews_Import_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_number" integer,
  "Email" boolean,
  "Last Name(*)" text,
  "First Name" text,
  "Second Last Name" boolean,
  "Title" boolean,
  "Sex" boolean,
  "Nationality Code" boolean,
  "Preferred Language Code" boolean,
  "Birth Date" boolean,
  "Birth Place" boolean,
  "Telephone" boolean,
  "Document Type" text,
  "Document Number" text,
  "Document Expiry Date" boolean,
  "Document Issue Date" boolean,
  "Document Issuing Country Code" boolean,
  "Document Issuing Country Subdivision Code" boolean,
  "Document Issuing City" boolean,
  "Document Support Number" boolean,
  "Occupation" boolean,
  "Car Registration Number" boolean,
  "Address Line 1" text,
  "Address Line 2" boolean,
  "City" text,
  "Postal Code" text,
  "Country Code" text,
  "Country Subdivision Code" boolean,
  "Customer Classification" boolean,
  "Internal Guest Notes" text,
  "Preferred Space Features" boolean,
  "Dietary Requirements" boolean,
  "Loyalty Code" boolean,
  "Company Id" boolean,
  "Tax Identification Number" boolean,
  "Accounting Code" boolean,
  "Billing Code" boolean,
  "Italian Destination Code" boolean,
  "Italian Fiscal Code" boolean,
  "Italian Lottery Code" boolean,
  "Invoiceable" boolean,
  "Process ID Image" boolean,
  "Process Verification Photo" boolean,
  "Send Marketing Emails" boolean,
  "Send Marketing Postal Mail" boolean,
  "Send Partner Marketing Emails" boolean,
  "Send Partner Marketing Postal Mail" boolean,
  "Arrival Date(*)" text,
  "Arrival Time" boolean,
  "Departure Date(*)" text,
  "Departure Time" boolean,
  "Person Counts(*)" text,
  "Adult Count(*)" text,
  "Child Count(*)" text,
  "Booker ID" boolean,
  "Companions" boolean,
  "Reservation Notes" text,
  "Confirmation Code" boolean,
  "Group Code" text,
  "Voucher Code" boolean,
  "Availability Block ID" boolean,
  "Currency Code" text,
  "Total Price" boolean,
  "Per Night Prices" text,
  "Prepaid Amount" boolean,
  "Prepayment Type" boolean,
  "Skip Automatic Settlement" boolean,
  "Allocated Room Category(*)" text,
  "Allocated Room Number" boolean,
  "Allocated Rate" text,
  "Included Products" boolean,
  "Partner Company" boolean,
  "Travel Agency" boolean,
  "Business Segment" boolean,
  "Reservation Purpose" boolean,
  "Release Date" boolean,
  "Channel manager number" boolean,
  "Channel number" text,
  "Channel manager integration ID" boolean,
  "Source" text
);

alter table public."Final_Format_All_Fields_Match_Mews_Import_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_All_Fields_Match_Mews_Import_15_10_2026" to service_role;

create unique index if not exists final_format_all_fields_match_mews_import_15_10_2026_nc_idx on public."Final_Format_All_Fields_Match_Mews_Import_15_10_2026" (nc_number);

delete from public."Final_Format_All_Fields_Match_Mews_Import_15_10_2026";

create table if not exists public."Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_number" integer,
  "Company Name(*)" text,
  "Telephone" boolean,
  "Contact Person" boolean,
  "Contact Notes" boolean,
  "Website" boolean,
  "Notes" boolean,
  "Department" boolean,
  "Address Line 1" boolean,
  "Address Line 2" boolean,
  "City" boolean,
  "Postal Code" boolean,
  "Country Code" boolean,
  "Mother Company Id" boolean,
  "Reference ID" text,
  "Fiscal Identifier" boolean,
  "Tax ID Number" text,
  "Additional Tax Identifier" boolean,
  "Accounting Code" boolean,
  "Billing Code" boolean,
  "External Identifier" boolean,
  "Invoice Due Interval" boolean,
  "Invoicing Email" boolean,
  "Invoiceable" boolean,
  "Add Fees To Invoices" boolean,
  "Add Tax Deducted Payment To Invoices" boolean,
  "IATA" boolean,
  "DUNS Number" boolean,
  "Cod. destinatario" boolean,
  "Fiscal code" boolean,
  "Tender Code (CIG)" boolean,
  "Project Code (CUP)" boolean
);

alter table public."Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026" to service_role;

create unique index if not exists final_format_all_fields_match_mews_import_companies_15_10_2026_nc_idx on public."Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026" (nc_number);

delete from public."Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026";

-- Add name-pair columns if tables already exist
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matching_name_pairs text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matching_name_pairs text;
-- Company match columns (Companies_Extraction_12_10_2026)
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists likely_company_label boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists partner_company text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists companies_match_tier text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matched_company_id text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matched_company_name text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists companies_match_signals text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists likely_company_label boolean;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists partner_company text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists companies_match_tier text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matched_company_id text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matched_company_name text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists companies_match_signals text;
-- Rent / deposit match (Allocated Rate + Prepaid Amount)
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_customers text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_seguimiento text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_housemonk text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_customers text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_seguimiento text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_housemonk text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_match boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposits_match boolean;
-- Guest name + document on mismatch tables
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists guest_name text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists guest_document_number text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists document_customers text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists document_seguimiento text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists document_housemonk text;
alter table public."Final_Format_Mismatch_Dates_15_10_2026" add column if not exists guest_name text;
alter table public."Final_Format_Mismatch_Dates_15_10_2026" add column if not exists guest_document_number text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists guest_name text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists guest_document_number text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists guest_name text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists guest_document_number text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Unit_Types_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Dates_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Extras_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists extras_customers text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists extras_housemonk text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists extras_customers text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists extras_housemonk text;
