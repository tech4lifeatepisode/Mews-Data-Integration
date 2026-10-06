-- Run in Supabase SQL editor if contract_drive_uploads already exists.

alter table public.contract_drive_uploads
  add column if not exists content_category text
    check (content_category in ('contract', 'information', 'payment', 'other')),
  add column if not exists content_category_folder text,
  add column if not exists route_segments_labeled text[] not null default '{}',
  add column if not exists storage_path_under_nc text;

comment on column public.contract_drive_uploads.content_category is
  'contract, information, payment, or other — from Drive folder names such as 02. CONTRACT, 01. INFORMATION, 03. PAYMENT.';

comment on column public.contract_drive_uploads.route_segments_labeled is
  'Same as route_segments but typed folders are prefixed, e.g. [contract] 02. CONTRACT.';

comment on column public.contract_drive_uploads.storage_path_under_nc is
  'Path under the NC customer folder with a leading category when known, e.g. information/01. INFORMATION (...)/file.jpg.';

create index if not exists contract_drive_uploads_content_category_idx
  on public.contract_drive_uploads (content_category, created_at desc);
