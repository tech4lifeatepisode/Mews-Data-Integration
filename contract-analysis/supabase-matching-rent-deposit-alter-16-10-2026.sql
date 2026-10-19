-- Rent + deposit three-way match (run before re-upload if tables already exist)
-- Monthly rent: Allocated Rate (fallback Per Night Prices / Total Price in build script)
-- Deposit: Prepaid Amount

alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_customers text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_seguimiento text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_housemonk text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_customers text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_seguimiento text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposit_housemonk text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists rent_match boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists deposits_match boolean;

create table if not exists public."Final_Format_Mismatch_Rent_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "rent_customers" text,
  "rent_seguimiento" text,
  "rent_housemonk" text
);

alter table public."Final_Format_Mismatch_Rent_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Rent_15_10_2026" to service_role;
create unique index if not exists final_format_mismatch_rent_15_10_2026_nc_idx
  on public."Final_Format_Mismatch_Rent_15_10_2026" (nc_number);

create table if not exists public."Final_Format_Mismatch_Deposits_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "nc_code" text,
  "nc_number" integer,
  "customers_final_id" text,
  "seguimiento_final_id" text,
  "housemonk_final_id" text,
  "deposit_customers" text,
  "deposit_seguimiento" text,
  "deposit_housemonk" text
);

alter table public."Final_Format_Mismatch_Deposits_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Final_Format_Mismatch_Deposits_15_10_2026" to service_role;
create unique index if not exists final_format_mismatch_deposits_15_10_2026_nc_idx
  on public."Final_Format_Mismatch_Deposits_15_10_2026" (nc_number);
