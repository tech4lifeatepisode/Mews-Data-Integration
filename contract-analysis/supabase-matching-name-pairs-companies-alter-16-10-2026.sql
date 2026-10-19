-- Run in Supabase SQL editor, then: node contract-extraction/upload-matching-across-final-format-15-10-2026.mjs

alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matching_name_pairs text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matching_name_pairs text;

alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists likely_company_label boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists partner_company text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists companies_match_tier text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matched_company_id text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matched_company_name text;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists companies_match_signals text;

alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists likely_company_label boolean;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists partner_company text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists companies_match_tier text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matched_company_id text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matched_company_name text;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists companies_match_signals text;

-- If company columns were created as boolean by mistake, fix types:
-- alter table public."Final_Format_Three_Way_Match_15_10_2026" alter column partner_company type text using partner_company::text;
