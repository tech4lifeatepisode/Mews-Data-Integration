-- Guest label + document on mismatch review tables (names, dates, rent, deposits)

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
