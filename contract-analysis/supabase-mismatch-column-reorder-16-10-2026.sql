-- Recreate mismatch tables: comparison fields, then *_final_id, then "Acutal Value" (last).
-- Then: cd contract-extraction && node upload-matching-across-final-format-15-10-2026.mjs

drop table if exists public."Final_Format_Mismatch_Names_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Names_15_10_2026" (
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
  "partner_company" text,
  "likely_company_label" boolean,
  "companies_match_tier" text,
  "matched_company_id" text,
  "matched_company_name" text,
  "companies_match_signals" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);
alter table public."Final_Format_Mismatch_Names_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Names_15_10_2026" to service_role;
create unique index final_format_mismatch_names_15_10_2026_nc_idx on public."Final_Format_Mismatch_Names_15_10_2026" (nc_number);

drop table if exists public."Final_Format_Mismatch_Dates_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Dates_15_10_2026" (
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
  "Acutal Value" text
);
alter table public."Final_Format_Mismatch_Dates_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Dates_15_10_2026" to service_role;
create unique index final_format_mismatch_dates_15_10_2026_nc_idx on public."Final_Format_Mismatch_Dates_15_10_2026" (nc_number);

drop table if exists public."Final_Format_Mismatch_Rent_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Rent_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "rent_customers" text,
  "rent_seguimiento" text,
  "rent_housemonk" text,
  "extras_customers" text,
  "extras_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);
alter table public."Final_Format_Mismatch_Rent_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Rent_15_10_2026" to service_role;
create unique index final_format_mismatch_rent_15_10_2026_nc_idx on public."Final_Format_Mismatch_Rent_15_10_2026" (nc_number);

drop table if exists public."Final_Format_Mismatch_Deposits_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Deposits_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "guest_name" text,
  "guest_document_number" text,
  "deposit_customers" text,
  "deposit_seguimiento" text,
  "deposit_housemonk" text,
  "extras_customers" text,
  "extras_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Deposits_15_10_2026" to service_role;
create unique index final_format_mismatch_deposits_15_10_2026_nc_idx on public."Final_Format_Mismatch_Deposits_15_10_2026" (nc_number);

drop table if exists public."Final_Format_Mismatch_Unit_Types_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Unit_Types_15_10_2026" (
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
create unique index final_format_mismatch_unit_types_15_10_2026_nc_idx on public."Final_Format_Mismatch_Unit_Types_15_10_2026" (nc_number);

drop table if exists public."Final_Format_Mismatch_Extras_15_10_2026" cascade;
create table public."Final_Format_Mismatch_Extras_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "meal_plan_customers" text,
  "meal_plan_seguimiento" text,
  "meal_plan_housemonk" text,
  "parking_customers" text,
  "parking_seguimiento" text,
  "parking_housemonk" text,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "Acutal Value" text
);
alter table public."Final_Format_Mismatch_Extras_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Extras_15_10_2026" to service_role;
create unique index final_format_mismatch_extras_15_10_2026_nc_idx on public."Final_Format_Mismatch_Extras_15_10_2026" (nc_number);
