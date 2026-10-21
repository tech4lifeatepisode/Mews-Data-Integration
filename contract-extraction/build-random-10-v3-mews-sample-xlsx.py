"""Build a diverse 10-row B2C V3 Customers sample xlsx (+ matching Companies if any)."""
import random
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "Mews_import_v2.10.0.xlsx"
SOURCE = ROOT / "Mews_import_V3_B2C_20_10_2026_combined.xlsx"
WORKBOOK_BASENAME = "Random_10_Sample_Mews_import_V3_B2C_20_10_2026_combined.xlsx"
OUTPUT = Path.home() / "Downloads" / f"V3_{WORKBOOK_BASENAME}"

SAMPLE_SIZE = 10
RANDOM_SEED = 20261020
# Mews rejects arrivals before the property historical-edit window — prefer future check-ins for test samples.
MIN_ARRIVAL_DATE = datetime(2026, 10, 21)


def header_row(ws) -> list[str]:
    return [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]


def read_data_rows(ws) -> list[tuple]:
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if any(cell is not None and str(cell).strip() != "" for cell in row):
            rows.append(row)
    return rows


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


def row_tags(row, idx: dict[str, int]) -> set[str]:
    tags = set()
    cat = row[idx["Allocated Room Category(*)"]]
    if cat:
        tags.add(f"cat:{cat}")
    tags.add("products:yes" if row[idx["Included Products"]] else "products:no")
    days = stay_days(row, idx)
    if days is not None:
        if days < 90:
            tags.add("stay:short")
        elif days <= 270:
            tags.add("stay:medium")
        else:
            tags.add("stay:long")
    return tags


def score_row(row, idx: dict[str, int], covered: set[str]) -> int:
    tags = row_tags(row, idx)
    novel = tags - covered
    score = len(novel) * 10
    if row[idx["Included Products"]]:
        score += 5
    days = stay_days(row, idx)
    if days is not None:
        score += min(days // 30, 12)
    return score


def pick_diverse_sample(rows: list[tuple], headers: list[str], n: int) -> list[tuple]:
    idx = {h: i for i, h in enumerate(headers)}
    rng = random.Random(RANDOM_SEED)
    pool = rows[:]
    rng.shuffle(pool)

    selected: list[tuple] = []
    covered: set[str] = set()
    used: set[int] = set()

    by_cat: dict[str, list[tuple]] = defaultdict(list)
    for row in pool:
        cat = row[idx["Allocated Room Category(*)"]] or "(blank)"
        by_cat[str(cat)].append(row)

    for cat in sorted(by_cat.keys(), key=lambda c: (-len(by_cat[c]), c)):
        if len(selected) >= n:
            break
        for row in sorted(by_cat[cat], key=lambda r: -score_row(r, idx, covered)):
            if id(row) in used:
                continue
            selected.append(row)
            used.add(id(row))
            covered |= row_tags(row, idx)
            break

    quotas = [("products:yes", 4), ("products:no", 4), ("stay:short", 2), ("stay:medium", 4), ("stay:long", 2)]
    counts = {k: sum(1 for r in selected if k in row_tags(r, idx)) for k, _ in quotas}

    while len(selected) < n:
        best, best_sc = None, -1.0
        for row in pool:
            if id(row) in used:
                continue
            tags = row_tags(row, idx)
            bonus = sum(15 for key, target in quotas if key in tags and counts[key] < target)
            sc = bonus + score_row(row, idx, covered) + rng.random()
            if sc > best_sc:
                best, best_sc = row, sc
        if best is None:
            break
        selected.append(best)
        used.add(id(best))
        covered |= row_tags(best, idx)
        for key, _ in quotas:
            if key in row_tags(best, idx):
                counts[key] += 1

    return selected[:n]


def write_sheet(ws, headers: list[str], data_rows: list[tuple]) -> None:
    for c, h in enumerate(headers, start=1):
        if ws.cell(row=1, column=c).value != h:
            raise SystemExit(f"Header mismatch col {c}: {ws.cell(row=1, column=c).value!r} != {h!r}")
    if ws.max_row > 1:
        ws.delete_rows(2, ws.max_row - 1)
    for r_idx, row in enumerate(data_rows, start=2):
        for c_idx, val in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Source not found: {SOURCE}. Run build-v3-mews-import-xlsx.mjs first.")
    if not TEMPLATE.is_file():
        raise SystemExit(f"Template not found: {TEMPLATE}")

    src_wb = openpyxl.load_workbook(SOURCE, read_only=True)
    cust_headers = header_row(src_wb["Customers"])
    co_headers = header_row(src_wb["Companies"])
    all_customers = read_data_rows(src_wb["Customers"])
    all_companies = read_data_rows(src_wb["Companies"])
    src_wb.close()

    uidx = {h: i for i, h in enumerate(cust_headers)}

    def arrival_on_or_after_min(row: tuple) -> bool:
        a = parse_date(row[uidx["Arrival Date(*)"]])
        return bool(a and a >= MIN_ARRIVAL_DATE)

    future_customers = [r for r in all_customers if arrival_on_or_after_min(r)]
    pool = future_customers if len(future_customers) >= SAMPLE_SIZE else all_customers
    if pool is future_customers:
        print(f"  Using {len(future_customers)} rows with arrival >= {MIN_ARRIVAL_DATE.date()}")

    picked = pick_diverse_sample(pool, cust_headers, SAMPLE_SIZE)

    shutil.copy2(TEMPLATE, OUTPUT)
    out_wb = openpyxl.load_workbook(OUTPUT)
    write_sheet(out_wb["Customers"], cust_headers, picked)
    write_sheet(out_wb["Companies"], co_headers, all_companies[:0])
    out_wb.save(OUTPUT)

    print(f"Wrote {OUTPUT}")
    print(f"  Customers: {len(picked)}")
    print(
        f"    with Included Products: {sum(1 for r in picked if r[uidx['Included Products']])}"
    )


if __name__ == "__main__":
    main()
