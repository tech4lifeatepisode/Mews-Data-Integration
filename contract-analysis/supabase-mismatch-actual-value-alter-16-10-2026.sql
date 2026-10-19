-- Empty manual-review column on all mismatch tables (between last comparison field and *_final_id).

alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Unit_Types_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Dates_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Extras_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists "Acutal Value" text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists "Acutal Value" text;
