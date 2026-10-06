-- Run if contract_drive_uploads exists but file_format is missing.

alter table public.contract_drive_uploads
  add column if not exists file_format text
    check (file_format is null or file_format in ('PDF', 'DOCX', 'Other'));

comment on column public.contract_drive_uploads.file_format is
  'PDF, DOCX, or Other — derived from mime_type and file name (files only).';

update public.contract_drive_uploads
set file_format = case
  when item_type <> 'file' then null
  when lower(coalesce(mime_type, '')) = 'application/pdf'
    or lower(coalesce(drive_name, '')) like '%.pdf'
    or lower(coalesce(drive_name, '')) like '%\_pdf' escape '\' then 'PDF'
  when lower(coalesce(mime_type, '')) like '%wordprocessingml%'
    or lower(coalesce(mime_type, '')) = 'application/msword'
    or lower(coalesce(drive_name, '')) like '%.docx'
    or lower(coalesce(drive_name, '')) like '%.doc' then 'DOCX'
  else 'Other'
end
where file_format is null;
