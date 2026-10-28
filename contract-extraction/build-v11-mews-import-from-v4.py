"""
V11 Mews import workbooks from the Tenancy-reconciled V4 tables (same Mews-safe sanitization as V10).

  node contract-extraction/export-v4-tables-csv-21-10-2026.mjs
  python contract-extraction/build-v11-mews-import-from-v4.py
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from _mews_v10_from_v4_common import build_v10_packages, filter_by_arrival_gte

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "Mews_import_v2.10.0.xlsx"
CUSTOMERS_CSV = ROOT / "contract-extraction" / "v11-customers-export-21-10-2026.csv"
COMPANIES_CSV = ROOT / "contract-extraction" / "v11-companies-export-21-10-2026.csv"
MANIFEST = ROOT / "contract-extraction" / "v11-mews-import-manifest.json"

MIN_ARRIVAL = datetime(2026, 10, 21)
DL = Path.home() / "Downloads"
STEM = "Mews_import_V4_B2C_and_B2B_21_10_2026_combined.xlsx"


def main() -> None:
    if not CUSTOMERS_CSV.is_file():
        raise SystemExit(f"Missing {CUSTOMERS_CSV}. Run: node contract-extraction/export-v4-tables-csv-21-10-2026.mjs")

    outputs = [
        ("full", DL / f"V11_Full_{STEM}", lambda rows, h: rows),
        (
            "importable_arrival_gte_2026-10-21",
            DL / f"V11_Importable_{STEM}",
            lambda rows, h: filter_by_arrival_gte(rows, h, MIN_ARRIVAL),
        ),
        ("full_repo", ROOT / "Mews_import_V11_Full_V4_B2C_B2B_21_10_2026_combined.xlsx", lambda rows, h: rows),
        (
            "importable_repo",
            ROOT / "Mews_import_V11_Importable_V4_B2C_B2B_21_10_2026_combined.xlsx",
            lambda rows, h: filter_by_arrival_gte(rows, h, MIN_ARRIVAL),
        ),
    ]
    results = build_v10_packages(
        template=TEMPLATE,
        customers_csv=CUSTOMERS_CSV,
        companies_csv=COMPANIES_CSV,
        outputs=outputs,
        manifest_path=MANIFEST,
    )
    for pkg in results["packages"]:
        print(f"[{pkg['label']}] {pkg['customers']} customers, {pkg['companies']} companies -> {pkg['path']}")


if __name__ == "__main__":
    main()
