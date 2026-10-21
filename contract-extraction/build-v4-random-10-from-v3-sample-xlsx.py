"""Build V4 random-10 sample from V3 sample: monthly in Per Night Prices, rate group names, spaced + in products."""
import re
import shutil
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "Mews_import_v2.10.0.xlsx"
SOURCE = Path.home() / "Downloads" / "V3_Random_10_Sample_Mews_import_V3_B2C_20_10_2026_combined.xlsx"
OUTPUT = Path.home() / "Downloads" / "V4_Random_10_Sample_Mews_import_V3_B2C_20_10_2026_combined.xlsx"

RATE_SHORT = "Short-Term Stays"
RATE_MID = "Mid-Term Stays"
RATE_LONG = "Long-Term Stays"


def parse_date(v) -> datetime | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None


def stay_days(row, idx: dict[str, int]) -> int | None:
    a = parse_date(row[idx["Arrival Date(*)"]])
    d = parse_date(row[idx["Departure Date(*)"]])
    if not a or not d:
        return None
    return (d - a).days


def rate_group(days: int | None) -> str:
    if days is None:
        return RATE_LONG
    if days <= 92:
        return RATE_SHORT
    if days <= 275:
        return RATE_MID
    return RATE_LONG


def parse_money(val) -> str | None:
    if val is None or val == "":
        return None
    s = str(val).strip()
    if "Stays" in s:
        return None
    m = re.match(r"^(\d+(?:\.\d+)?)", s.replace(",", ".").replace(" ", ""))
    if not m:
        return None
    n = float(m.group(1))
    return str(int(n)) if n == int(n) else str(n)


def space_products(val) -> str | None:
    if val is None or str(val).strip() == "":
        return val
    parts = [p.strip() for p in str(val).split(";")]
    out = []
    for p in parts:
        out.append(re.sub(r"(\d+)\+(\d+)(?:\+(\d+))?", lambda m: f"{m.group(1)} + {m.group(2)}" + (f" + {m.group(3)}" if m.group(3) else ""), p))
    return "; ".join(out)


def mews_import_ready(row: list, idx: dict[str, int]) -> None:
    if "Person Counts(*)" in idx:
        row[idx["Person Counts(*)"]] = None
    if "Per Night Prices" in idx:
        row[idx["Per Night Prices"]] = None
    if "Total Price" in idx:
        row[idx["Total Price"]] = None
    if "Arrival Time" in idx:
        row[idx["Arrival Time"]] = None
    if "Departure Time" in idx:
        row[idx["Departure Time"]] = None
    prepaid_i = idx.get("Prepaid Amount")
    prep_type_i = idx.get("Prepayment Type")
    if prepaid_i is not None and prep_type_i is not None:
        prepaid = row[prepaid_i]
        if prepaid is not None and str(prepaid).strip() and any(ch.isdigit() for ch in str(prepaid)):
            if not row[prep_type_i]:
                row[prep_type_i] = "Deposit"
        else:
            row[prepaid_i] = None
            row[prep_type_i] = None


def transform_row(row: tuple, idx: dict[str, int]) -> tuple:
    row = list(row)
    monthly = parse_money(row[idx["Allocated Rate"]]) or parse_money(row[idx["Per Night Prices"]])
    days = stay_days(row, idx)
    row[idx["Allocated Rate"]] = rate_group(days)
    ip = idx.get("Included Products")
    if ip is not None and row[ip] is not None:
        row[ip] = space_products(row[ip])
    mews_import_ready(row, idx)
    return tuple(row)


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing source: {SOURCE}")
    src = openpyxl.load_workbook(SOURCE, read_only=True)
    headers = [c.value for c in next(src["Customers"].iter_rows(min_row=1, max_row=1))]
    idx = {h: i for i, h in enumerate(headers)}
    rows = []
    for row in src["Customers"].iter_rows(min_row=2, values_only=True):
        if any(cell is not None and str(cell).strip() for cell in row):
            rows.append(transform_row(row, idx))
    co_headers = [c.value for c in next(src["Companies"].iter_rows(min_row=1, max_row=1))]
    src.close()

    shutil.copy2(TEMPLATE, OUTPUT)
    wb = openpyxl.load_workbook(OUTPUT)
    ws = wb["Customers"]
    if ws.max_row > 1:
        ws.delete_rows(2, ws.max_row - 1)
    for r_idx, row in enumerate(rows, start=2):
        for c_idx, val in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    ws_co = wb["Companies"]
    if ws_co.max_row > 1:
        ws_co.delete_rows(2, ws_co.max_row - 1)
    wb.save(OUTPUT)
    print(f"Wrote {OUTPUT} ({len(rows)} customers)")


if __name__ == "__main__":
    main()
