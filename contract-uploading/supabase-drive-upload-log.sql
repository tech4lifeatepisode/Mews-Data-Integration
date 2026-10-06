-- Run once in the Supabase SQL editor for project jujvtuyksxkoclegjznb.
-- One row per Drive file or folder touched by a sync into the Contracts bucket.

create table if not exists public.contract_drive_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sync_id uuid not null,
  status text not null check (status in ('uploaded', 'failed', 'skipped', 'listed')),
  item_type text not null check (item_type in ('file', 'folder')),
  google_account text,
  drive_file_id text,
  drive_name text,
  parent_drive_id text,
  source_folder_route text,
  source_route text,
  route_segments text[] not null default '{}',
  storage_bucket text,
  storage_path text,
  path_category text check (path_category in ('Information', 'Contracts', 'Payments', 'Other')),
  ai_extraction text check (ai_extraction in ('Yes', 'No')),
  nc_number text,
  mime_type text,
  size_bytes bigint,
  error_message text
);

comment on table public.contract_drive_uploads is
  'Audit log for Google Drive to Supabase Storage copies. status=uploaded means the object was stored; failed includes the reason; skipped means the file was seen but not copied; listed means a folder route was entered.';

comment on column public.contract_drive_uploads.path_category is
  'Information, Contracts, Payments, or Other — from folder names in route_segments / storage_path.';

comment on column public.contract_drive_uploads.ai_extraction is
  'Yes when path_category is Contracts and nc_number >= 574 (NC_0574+). Otherwise No.';

create index if not exists contract_drive_uploads_sync_id_idx
  on public.contract_drive_uploads (sync_id, created_at);

create index if not exists contract_drive_uploads_status_idx
  on public.contract_drive_uploads (status, created_at desc);

create index if not exists contract_drive_uploads_source_route_idx
  on public.contract_drive_uploads (source_route);

alter table public.contract_drive_uploads enable row level security;

-- The uploader uses the service role, which bypasses RLS.
-- Dashboard and SQL editor access remain available to project owners.
