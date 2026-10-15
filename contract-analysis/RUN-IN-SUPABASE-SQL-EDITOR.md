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
`External Data Sources/Final Format_Customers_Contracts_Extraction_15.10.2026.csv`
