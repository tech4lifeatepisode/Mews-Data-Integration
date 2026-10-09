-- Run in Supabase SQL editor after contract_drive_uploads already exists.

alter table public.contract_drive_uploads
  add column if not exists path_category text
    check (path_category in ('Information', 'Contracts', 'Payments', 'Other')),
  add column if not exists ai_extraction text
    check (ai_extraction in ('Yes', 'No')),
  add column if not exists nc_number text,
  add column if not exists file_format text
    check (file_format is null or file_format in ('PDF', 'DOCX', 'Other'));

comment on column public.contract_drive_uploads.path_category is
  'Drive subtree: Information, Contracts, Payments, or Other (from route_segments / storage_path).';

comment on column public.contract_drive_uploads.ai_extraction is
  'Yes when path_category is Contracts and nc_number >= 574 (NC_0574+). Otherwise No.';

create index if not exists contract_drive_uploads_path_category_idx
  on public.contract_drive_uploads (path_category, created_at desc);

create index if not exists contract_drive_uploads_ai_extraction_idx
  on public.contract_drive_uploads (ai_extraction, created_at desc);

-- Rough backfill for existing rows (re-sync or retry will set precise values on new inserts).
update public.contract_drive_uploads
set
  path_category = case
    when coalesce(source_route, '') ilike '%INFORMATION%' or coalesce(storage_path, '') ilike '%INFORMATION%' then 'Information'
    when coalesce(source_route, '') ilike '%CONTRACT%' or coalesce(storage_path, '') ilike '%CONTRACT%' then 'Contracts'
    when coalesce(source_route, '') ilike '%PAYMENT%' or coalesce(source_route, '') ilike '%PAYMENT%'
      or coalesce(source_route, '') ilike '%DEPOSIT%' or coalesce(storage_path, '') ilike '%DEPOSIT%' then 'Payments'
    else 'Other'
  end,
  nc_number = (
    select (regexp_match(seg, 'NC[_\s-]*(\d+)', 'i'))[1]::int::text
    from unnest(route_segments) as seg
    where seg ~* 'NC[_\s-]*\d+'
    limit 1
  ),
  ai_extraction = case
    when item_type = 'folder' then 'No'
    else 'No'
  end
where path_category is null or ai_extraction is null;

-- After this migration, run reconcile-ai per sync_id so file rows get the correct Yes/No.
