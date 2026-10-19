-- Guests with NC in Seguimiento + Contracts final but no HouseMonk match (15 Oct 2026).
create table if not exists public."Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026" (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nc_code text not null,
  nc_number integer not null,
  cohort_label text not null,
  contract_situation text,
  in_customers_final boolean not null default false,
  in_seguimiento_final boolean not null default false,
  in_housemonk_final boolean not null default false,
  email text,
  first_name text,
  last_name text,
  document_number text,
  document_type text,
  telephone text,
  arrival_date text,
  departure_date text,
  unit_type text,
  room_number text,
  business_segment text,
  monthly_rate text,
  prepaid_deposit text,
  companions text,
  reservation_notes text,
  linked_ncs text,
  analysis_detail text,
  source_customers text,
  source_seguimiento text,
  customers_final_id uuid,
  seguimiento_final_id uuid,
  housemonk_final_id uuid,
  storage_path text,
  source_document text
);

alter table public."Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026" enable row level security;
grant select, insert, update, delete on public."Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026" to service_role;

create unique index if not exists missing_hm_ncs_seg_contracts_15_10_nc_idx
  on public."Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026" (nc_number);








delete from public."Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026";
