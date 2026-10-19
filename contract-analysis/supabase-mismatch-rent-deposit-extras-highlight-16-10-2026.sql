-- Rent / deposit mismatch tables: flag meal plan, parking, Extra: products, extra person (Customers vs HouseMonk).
-- Run once in Supabase SQL editor, then: node contract-extraction/upload-matching-across-final-format-15-10-2026.mjs

alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists extras_customers text;
alter table public."Final_Format_Mismatch_Rent_15_10_2026" add column if not exists extras_housemonk text;

alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists extras_customers text;
alter table public."Final_Format_Mismatch_Deposits_15_10_2026" add column if not exists extras_housemonk text;
