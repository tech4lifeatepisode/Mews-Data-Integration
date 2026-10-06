# Invoices Comparison to Guest Report

This repository contains monthly operation workbooks (`LIBRO`) and reporting workbooks/scripts (`Report`) used to compare invoices against guest and tenancy data.

## Project Structure

- `LIBRO/`: Monthly workbook files and the generated `No_Show_Extractions.xlsx`.
- `Report/`: Invoice comparison workbook and helper scripts.
- `extract_no_shows.py`: Extracts "No Show" rows across monthly sheets into a single workbook.
- `Report/enrich_carabanchel_company_columns.py`: Adds and fills `Company Name` and `Company ID` columns in the Carabanchel report sheet.
- `Report/classify_company_id.py`: Classifies IDs in `Company ID.xlsx` column A and writes `Yes/No` to column B.

## Requirements

- Python 3.10+
- Excel installed (required for scripts that use `xlwings`)
- Python packages:
  - `openpyxl`
  - `xlwings`
  - `openai`
  - `python-dotenv`

Install dependencies:

```bash
pip install openpyxl xlwings openai python-dotenv
```

## Environment Variables

Create `Report/.env` with:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5.2-2025-12-11
```

> `.env` is ignored by git and should not be committed.

## Usage

Run from project root:

```bash
python extract_no_shows.py
python Report/classify_company_id.py
python Report/enrich_carabanchel_company_columns.py
```

## Notes

- Keep Excel workbooks closed while scripts are writing changes.
- Regenerate outputs after workbook updates to keep reports in sync.
