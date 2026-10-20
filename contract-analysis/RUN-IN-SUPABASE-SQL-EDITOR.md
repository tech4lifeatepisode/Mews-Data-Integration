# Supabase SQL editor — paste **only** the `.sql` file

Do **not** paste chat messages or markdown into the SQL editor.

1. Open: https://supabase.com/dashboard/project/jujvtuyksxkoclegjznb/sql/new  
2. In Cursor/VS Code, open **`contract-analysis/supabase-final-format-tables.sql`**  
3. Select all (`Ctrl+A`) and copy (`Ctrl+C`) **that file only**  
4. Paste into the Supabase SQL editor and click **Run**  
5. Then load data:

```bash
cd contract-extraction
node upload-final-format-csvs.mjs
```

Expected: **764** rows in `Final_Format_HouseMonk_15_10_2026`, **858** in `Final_Format_Seguimiento_15_10_2026`.

---

### Customers contracts (current/future from AI extraction table)

1. Run **`contract-analysis/supabase-final-format-customers-contracts-15-10-2026.sql`**
2. Then:

```bash
cd contract-extraction
node build-upload-final-format-customers.mjs
```

Creates **`Final_Format_Customers_Contracts_Extraction_15_10_2026`** and CSV  

---

### B2B2C possible no contracts (20 NC cohort)

1. Run **`contract-analysis/supabase-b2b2c-possible-no-contracts-15-10-2026.sql`** (DDL + data)
2. Or, if the table already exists:

```bash
cd contract-extraction
node upload-b2b2c-possible-no-contracts-15-10-2026.mjs
```

Table: **`B2B2C_Possible_No_Contracts_15_10_2026`** — merged from Customers / Seguimiento / HouseMonk final tables.

---

### Missing HouseMonk NCs (9 — in Seguimiento + Contracts, no HM match)

1. Run **`contract-analysis/supabase-missing-housemonk-ncs-15-10-2026.sql`** (DDL + `delete from` only — **0 rows**; last NODE gaps NC_0644 / NC_0826 removed as early move-out / cancelled)
2. Or after DDL exists:

```bash
cd contract-extraction
node upload-missing-housemonk-ncs-15-10-2026.mjs
```

Table: **`Missing_HouseMonk_NCs_Seguimiento_Contracts_15_10_2026`**  
Cohort label: *Missing HouseMonk NCs but in Seguimento and Contracts_15.10.2026*

`External Data Sources/Final Format_Customers_Contracts_Extraction_15.10.2026.csv`

---

### Possible BCN properties (blank HM Group Code — Padilla / PRAL / ENT)

1. Run **`contract-analysis/supabase-possible-bcn-properties-15-10-2026.sql`** (DDL + **114** rows)
2. Or after DDL exists:

```bash
cd contract-extraction
node upload-possible-bcn-properties-15-10-2026.mjs
```

Table: **`Possible_BCN_Properties_15_10_2026`**  
Source: **`Final_Format_HouseMonk_15_10_2026`** rows with empty `Group Code`, unit type **not** NODE Episode (Standard / Terrace / Rooftop / Comfort / 2-bed taxonomy), room like `3-6`, `PRAL-2`, `ENT-*` (not `-1002`, `2105`, `0070`).

---

### Missing Group Code in HouseMonk final (56 — NODE / Madrid remainder)

1. Run **`contract-analysis/supabase-missing-group-code-hm-15-10-2026.sql`** (DDL + **56** rows)
2. Or after DDL exists:

```bash
cd contract-extraction
node upload-missing-group-code-hm-15-10-2026.mjs
```

Table: **`Missing_Group_Code_HouseMonk_15_10_2026`**  
Local list: **`contract-extraction/missing-group-code-hm-56-15-10-2026.csv`** / **`.json`**

---

### Three-way match (Customers + Seguimiento + HouseMonk)

HouseMonk rows in **`Missing_Group_Code_HouseMonk_15_10_2026`** are **excluded** from matching.

1. Run **`contract-analysis/supabase-matching-across-final-format-15-10-2026-ddl.sql`** in the SQL editor (small — tables only)
2. Run **`contract-analysis/supabase-matching-name-pairs-companies-alter-16-10-2026.sql`** (name-pair + Companies_Extraction match columns on main + name mismatch tables)
3. Run **`contract-analysis/supabase-matching-rent-deposit-alter-16-10-2026.sql`** (`rent_match`, `deposits_match`, rent/deposit mismatch tables)
4. Run **`contract-analysis/supabase-all-fields-match-mews-import-16-10-2026.sql`** (Mews-import-shaped rows where `all_fields_match`)
5. Run **`contract-analysis/supabase-mismatch-guest-columns-alter-16-10-2026.sql`** (`guest_name`, `guest_document_number` on names/dates/rent/deposit mismatch tables)
6. Run **`contract-analysis/supabase-mismatch-rent-deposit-extras-highlight-16-10-2026.sql`** (`extras_customers`, `extras_housemonk` on rent/deposit mismatch tables — meal plan, parking, `Extra:` products, extra person)
7. Optional: **`contract-analysis/supabase-mismatch-column-reorder-16-10-2026.sql`** drop/recreates mismatch tables with **`Acutal Value` last** — **always re-run upload after** (recreate clears rows)
7. Load rows via API (too large for one SQL editor paste):

```bash
cd contract-extraction
node upload-matching-across-final-format-15-10-2026.mjs
```

Do **not** paste `supabase-matching-across-final-format-15-10-2026.sql` (legacy combined file — editor size limit).

**Main table:** `Final_Format_Three_Way_Match_15_10_2026` — one row per NC in ≥2 sources, with name / document / unit / dates / rent / deposit / meal+parking flags, name-pair stats, and optional **`Companies_Extraction_12_10_2026`** match fields (`matched_company_name`, `companies_match_tier`, etc.). (Re-run DDL if you previously created the too-long table name — Postgres truncates at 63 chars.)

**Rent + deposits:** Rent uses normalized **`Allocated Rate`** (fallback `Per Night Prices` / `Total Price`); deposits use **`Prepaid Amount`**. When **Customers + HouseMonk** exist, `rent_match`, `deposits_match`, and the rent/deposit mismatch tables use only that pair within **±€10** — Seguimiento differences do not count. Without both C+H, each field is pairwise across present sources (same ±€10). **Fundación Mamá Cumbé B2B:** company agreement text uses **1441€/mes (incl. 10% IVA)** per unit; HouseMonk/Seguimiento bill **1310€/mes** — matching and `rent_customers` use **1310** for that cohort.

**Other company / B2B contracts:** When **Seguimiento and HouseMonk agree** on rent or deposit and the contract row is **company-linked** (Partner Company, Companies_Extraction match, or company-name guest), matching uses **operational HM values** (same as fixing PDF/agreement extraction vs billing). Audit: `node contract-extraction/tmp-audit-mismatch-rent-deposit-companies.mjs` → `audit-mismatch-rent-deposit-companies-16-10-2026.json`. Optional data align: `node contract-extraction/tmp-fix-company-operational-rent-deposit.mjs`. `all_fields_match` requires `rent_match` and `deposits_match` not false.

**Match rule (names + extras + rent + deposits):** When both **Customers** and **HouseMonk** exist, `names_match`, `extras_match`, `rent_match`, and `deposits_match` use only that pair — Seguimiento disagreements do not flip those flags or add the corresponding mismatch rows. Documents, units, and dates still require agreement across all present sources (where applicable).

**Customers↔HouseMonk name relaxations:** Besides strict first-name + shared surname, C↔H counts as match when normalized full names match, all contract name tokens appear in the HM guest name (e.g. extra first name on HM), first-name one-letter/variant (e.g. Luis/Lluis), or ≥2 shared name tokens with high overlap.

**Unit types:** When Customers and HouseMonk exist, `unit_types_match` uses canonical keys from HM wording (The Standard with Terrace, Two Bedroom (2+1), typos like Standar, Studio Standard + Terrace, PMR ignored, Seguimiento `(1/2)` shorthand). Seguimiento-only unit label differences do not force a mismatch.

**Extras (meal / parking):** Seguimiento is **not** used for `extras_match` or `Final_Format_Mismatch_Extras_15_10_2026`. When **Customers + HouseMonk** exist, `extras_match` is **true** (HM tenancy/invoice feeds do not carry contract-style `Meal plan:` / `Parking:` flags — see `build-housemonk-import.py`). Mismatch rows remain only for rare **Customers + Seguimiento** pairs without HM where meal/parking in notes differ.

If the upload script reports **`omittedColumns`**, the API insert skipped columns missing in Postgres — run step 2 above, then re-run the upload.

**Mismatch tables:**

- `Final_Format_Mismatch_Names_15_10_2026`
- `Final_Format_Mismatch_Unit_Types_15_10_2026`
- `Final_Format_Mismatch_Dates_15_10_2026`
- `Final_Format_Mismatch_Extras_15_10_2026`
- `Final_Format_Mismatch_Rent_15_10_2026`
- `Final_Format_Mismatch_Deposits_15_10_2026`

**All-fields match → Mews import (Customers):** `Final_Format_All_Fields_Match_Mews_Import_15_10_2026` — every NC with `all_fields_match` on the three-way table, **plus every B2B contract-authoritative NC** (`b2b-contract-authoritative-ncs-16-10-2026.json`) even when not all-fields match. Each row uses **`Group Code`** and **`Internal Guest Notes`** = `NC_XXXX` (same as B2B extraction / **`Mews_import_v2.10.0.xlsx`** → **Customers**). Column order: `contract-extraction/mews-customer-headers.mjs`. DDL: `contract-analysis/supabase-all-fields-match-mews-import-16-10-2026.sql`.

**Mews import (Companies):** `Final_Format_All_Fields_Match_Mews_Import_Companies_15_10_2026` — one row per B2B NC that has a customer import row, fields from **`Companies_Extraction_12_10_2026`** when matched (else partner company on the contract). Column order: `contract-extraction/mews-company-headers.mjs`. **Run once in SQL Editor:** `contract-analysis/supabase-all-fields-match-mews-import-companies-16-10-2026.sql`, then re-run `node contract-extraction/upload-matching-across-final-format-15-10-2026.mjs`.

**Mews import 19 Oct (solved mismatches):** `Final_Format_All_Fields_Match_Mews_Import_19_10_2026` + `Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026` — starts from the **15_10** Mews tables, adds **109** reservations from solved mismatch CSVs (Rent / Deposits / Names / Unit types) using **`Acutal Value`** / **`Actual Value`** on rent, deposit, unit, and name fields. **Run in SQL Editor (both files):** `supabase-all-fields-match-mews-import-19-10-2026.sql`, `supabase-all-fields-match-mews-import-companies-19-10-2026.sql`, then `node contract-extraction/upload-mews-import-19-10-2026.mjs`.

**V2 Companies empty after DDL?** PostgREST may not see a new table until the schema cache reloads. Run **`contract-analysis/supabase-reload-postgrest-schema.sql`**, wait ~10s, then `node contract-extraction/upload-v2-mews-import-19-10-2026.mjs` again. If upload still reports `companiesUpload.skipped`, run the generated **`contract-analysis/supabase-v2-companies-seed-19-10-2026.sql`** (156 rows) in the SQL Editor.

**V2 Mews import 19 Oct:** `V2_Final_Format_All_Fields_Match_Mews_Import_19_10_2026` + `V2_Final_Format_All_Fields_Match_Mews_Import_Companies_19_10_2026` — same column layout as **19_10**, enriched per **NC** from Customers + HouseMonk + **Tenancy CSV** (`contract-analysis/External Data Sources/Tenancy-14-10-2026-044225.csv`, **NC** column) + **`Companies_Extraction_12_10_2026`**. **CHAMARI ITG / B42861468** is stripped (landlord — not guest/partner). B2B cohort = `b2b-contract-authoritative-ncs-16-10-2026.json` ∪ `b2b-seguimiento-ncs-20-10-2026.json` (287 NCs); **V2 Companies** gets one row per B2B NC with tax/address from extraction match. **Room category** from room-number map. **Customers:** `Departure Date(*)` ≥ **2026-11-05** (`MEWS_MIN_DEPARTURE_DATE`). Workflow: `node build-room-number-category-map.mjs` → V2 DDL (customers + companies) → `node upload-v2-mews-import-19-10-2026.mjs`.
