"""Filter Seguimiento Leasing CSV to current/future reservations per NC."""
import argparse
import csv
import re
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "External Data Sources"
DEFAULT_IN = ROOT / "Seguimiento Leasing Carabanchel (new .LIFE) .xlsx - Leasing Update (1).csv"
DEFAULT_OUT = ROOT / "Current Seguirmento data 15.10.2026.csv"

NC_RE = re.compile(r"^NC_\d+", re.I)
ACTIVE_STATUSES = {
    "let",
    "booked",
    "signed",
    "occupied",
    "reserved",
    "renewal",
    "renovation",
}


def clean(value):
    return (value or "").strip()


def parse_date(value):
    value = clean(value)
    if not value:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value[:10]):
        return value[:10]
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", value)
    if not match:
        return ""
    day, month, year = (int(part) for part in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def find_header_row(lines):
    for index, line in enumerate(lines):
        joined = ",".join(line).lower()
        if "unique code" in joined and "contract start" in joined:
            return index
    raise ValueError("Could not find Seguimiento header row (Unique code / Contract Start).")


def read_seguimiento(path: Path):
    raw = path.read_text(encoding="utf-8-sig").splitlines()
    reader = csv.reader(raw)
    lines = list(reader)
    header_index = find_header_row(lines)
    headers = [clean(h) for h in lines[header_index]]
    rows = []
    for line in lines[header_index + 1 :]:
        if not any(clean(cell) for cell in line):
            continue
        record = {headers[i]: clean(line[i]) if i < len(line) else "" for i in range(len(headers))}
        nc = clean(record.get("Unique code") or record.get("Deal ID (Hbt=Hsk)") or "")
        if not NC_RE.match(nc):
            continue
        record["_nc"] = nc.upper()
        rows.append(record)
    return headers, rows


def end_date_for_row(row):
    for key in ("Move-Out", "Original Check-Out ", "Original Check-Out"):
        parsed = parse_date(row.get(key))
        if parsed:
            return parsed
    return ""


def status_tokens(row):
    tokens = []
    for key in ("Label", "Category"):
        text = clean(row.get(key)).lower()
        if text:
            tokens.append(text)
    return tokens


def is_current_or_future(row, as_of: date):
    end = end_date_for_row(row)
    if end:
        return end >= as_of.isoformat()
    tokens = status_tokens(row)
    if any(token in ACTIVE_STATUSES for token in tokens):
        return True
    if any("cancel" in token or "expired" in token or "moved" in token for token in tokens):
        return False
    return False


def latest_per_nc(rows):
    best = {}
    for row in rows:
        nc = row["_nc"]
        rank = (end_date_for_row(row) or "", parse_date(row.get("Contract Start")) or "")
        if nc not in best or rank >= best[nc][0]:
            best[nc] = (rank, row)
    kept = [item[1] for item in best.values()]
    kept.sort(key=lambda row: (row["_nc"], end_date_for_row(row) or ""))
    return kept


def write_csv(path: Path, headers, rows):
    out_headers = [h for h in headers if h]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=out_headers, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in out_headers})


def main():
    parser = argparse.ArgumentParser(description="Filter Seguimiento leasing export to current/future NC rows.")
    parser.add_argument("--input", type=Path, default=DEFAULT_IN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--as-of", default="2026-10-15")
    args = parser.parse_args()
    as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date()

    headers, rows = read_seguimiento(args.input)
    current = [row for row in rows if is_current_or_future(row, as_of)]
    before = len(current)
    current = latest_per_nc(current)

    write_csv(args.output, headers, current)
    print(
        f"wrote {len(current)} NC rows (current/future as of {as_of.isoformat()}) to {args.output} "
        f"from {len(rows)} NC rows in source ({len(rows) - before} past excluded, "
        f"{before - len(current)} duplicate NC rows collapsed)"
    )


if __name__ == "__main__":
    main()
