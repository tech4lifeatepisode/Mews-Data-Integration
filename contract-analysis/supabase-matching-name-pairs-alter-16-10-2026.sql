-- Run once before re-upload (adds pairwise name columns)
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Three_Way_Match_15_10_2026" add column if not exists matching_name_pairs text;

alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists at_least_one_name_pair_match boolean;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists name_pairs_matching_count integer;
alter table public."Final_Format_Mismatch_Names_15_10_2026" add column if not exists matching_name_pairs text;
