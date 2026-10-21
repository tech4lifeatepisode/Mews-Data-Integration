-- HouseMonk tenancy export (14 Oct 2026) merged with Final_Format_HouseMonk — NC required per row.
-- Data: contract-extraction/upload-housemonk-tenancy-lifecycle-nc-14-10-2026.mjs

create table if not exists public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nc_number integer not null,
  nc_code text not null,
  tenancy_contract_id text not null,
  tenancy_status text,
  cancellation_reason text,
  lifecycle_label text,
  lifecycle_flags text,
  is_occupied boolean not null default false,
  check_in_date text,
  check_out_date text,
  move_out_date text,
  allocated_room_number text,
  unit_category text,
  property_name text,
  monthly_rent text,
  deposit_amount text,
  contract_type text,
  tenancy_tenant_name text,
  tenancy_tenant_id text,
  tenancy_tenant_email text,
  tenancy_tenant_phone text,
  guest_first_name text,
  guest_last_name text,
  guest_second_last_name text,
  guest_document_number text,
  guest_document_type text,
  guest_email text,
  guest_telephone text,
  guest_address_line_1 text,
  guest_address_line_2 text,
  guest_city text,
  guest_postal_code text,
  guest_country_code text,
  guest_nationality_code text,
  housemonk_final_id uuid,
  housemonk_match_method text,
  housemonk_group_code text,
  housemonk_snapshot jsonb,
  same_guest_has_occupied_stay boolean not null default false,
  matching_occupied_contract_id text
);

-- If table already exists from an earlier DDL run:
alter table public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026"
  add column if not exists same_guest_has_occupied_stay boolean not null default false;
alter table public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026"
  add column if not exists matching_occupied_contract_id text;

alter table public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" enable row level security;
grant select, insert, update, delete on public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" to service_role;

create unique index if not exists housemonk_tenancy_lifecycle_nc_14_10_2026_contract_idx
  on public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" (tenancy_contract_id);

create index if not exists housemonk_tenancy_lifecycle_nc_14_10_2026_nc_idx
  on public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" (nc_number);

create index if not exists housemonk_tenancy_lifecycle_nc_14_10_2026_status_idx
  on public."HouseMonk_Tenancy_Lifecycle_NC_14_10_2026" (tenancy_status);
