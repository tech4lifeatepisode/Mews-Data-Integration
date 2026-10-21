"""
List HouseMonk tenancy export rows that represent cancellations / move-outs (14 Oct 2026 snapshot).

The CSV does NOT use UI labels "Cancelled" or "Moved Out". Mapping used here:
  - Cancellation Reason filled → cancellation
  - Tenancy Status: Shifted | Under Notice | Booked (not Occupied)
  - Move out date before snapshot and status != Occupied → ended stay

Outputs:
  contract-analysis/tenancy-cancel-moveout-all-rows-14-10-2026.csv
  contract-analysis/tenancy-cancel-moveout-by-nc-14-10-2026.csv  (one row per NC, all statuses for that NC)
"""
from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "contract-analysis/External Data Sources/Tenancy-14-10-2026-044225.csv"
OUT_ALL = ROOT / "contract-analysis/tenancy-cancel-moveout-all-rows-14-10-2026.csv"
OUT_BY_NC = ROOT / "contract-analysis/tenancy-cancel-moveout-by-nc-14-10-2026.csv"
SNAPSHOT = datetime(2026, 10, 14)

OUT_COLS = [
    "NC",
    "Contract ID",
    "Tenancy Status",
    "Cancellation Reason",
    "Tenant Name",
    "Tenant ID",
    "Door",
    "Property",
    "Contract Start Date",
    "Contract End Date",
    "Move out date",
    "Tenant Rent",
    "lifecycle_flag",
]


def parse_d(s: str) -> datetime | None:
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def lifecycle_flags(row: dict) -> list[str]:
    flags: list[str] = []
    st = (row.get("Tenancy Status") or "").strip()
    cr = (row.get("Cancellation Reason") or "").strip()
    mo = parse_d(row.get("Move out date") or "")

    if cr:
        flags.append("cancellation_reason")
    if st == "Shifted":
        flags.append("status_shifted")
    if st == "Under Notice":
        flags.append("status_under_notice")
    if st == "Booked":
        flags.append("status_booked")
    if mo and mo < SNAPSHOT and st != "Occupied":
        flags.append("move_out_before_snapshot")
    if st and st != "Occupied" and not flags:
        flags.append(f"status_{st.lower().replace(' ', '_')}")
    return flags


def main() -> None:
    with SRC.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    flagged = []
    for r in rows:
        flags = lifecycle_flags(r)
        st = (r.get("Tenancy Status") or "").strip()
        if st == "Occupied" and not (r.get("Cancellation Reason") or "").strip():
            continue
        if not flags:
            continue
        out = {k: (r.get(k) or "").strip() for k in OUT_COLS if k != "lifecycle_flag"}
        out["lifecycle_flag"] = "|".join(flags)
        flagged.append(out)

    flagged.sort(key=lambda x: (x.get("NC") or "zzz", x.get("Contract ID") or ""))

    with OUT_ALL.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS)
        w.writeheader()
        w.writerows(flagged)

    by_nc: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        nc = (r.get("NC") or "").strip()
        if not nc or not nc.isdigit():
            continue
        by_nc[nc].append(r)

    nc_summary = []
    for nc in sorted(by_nc.keys(), key=int):
        group = by_nc[nc]
        statuses = sorted({(g.get("Tenancy Status") or "").strip() for g in group})
        has_cancel = any((g.get("Cancellation Reason") or "").strip() for g in group)
        has_non_occ = any((g.get("Tenancy Status") or "").strip() != "Occupied" for g in group)
        if not has_cancel and not has_non_occ:
            continue
        nc_summary.append(
            {
                "NC": f"NC_{int(nc):04d}",
                "nc_number": nc,
                "tenancy_row_count": len(group),
                "statuses": "|".join(statuses),
                "has_cancellation_reason": "yes" if has_cancel else "",
                "contract_ids": "|".join(sorted({(g.get("Contract ID") or "").strip() for g in group if g.get("Contract ID")})),
                "doors": "|".join(sorted({(g.get("Door") or "").strip() for g in group if g.get("Door")})),
                "tenant_names": "|".join(sorted({(g.get("Tenant Name") or "").strip() for g in group if g.get("Tenant Name")}))[:500],
            }
        )

    nc_cols = list(nc_summary[0].keys()) if nc_summary else ["NC"]
    with OUT_BY_NC.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=nc_cols)
        w.writeheader()
        w.writerows(nc_summary)

    with_nc = sum(1 for r in flagged if (r.get("NC") or "").strip())
    print(f"Source rows: {len(rows)}")
    print(f"Flagged reservation rows (non-Occupied or cancellation reason): {len(flagged)}")
    print(f"  of which with NC column: {with_nc}")
    print(f"NCs with any non-Occupied/cancel tenancy: {len(nc_summary)}")
    print(f"Wrote {OUT_ALL}")
    print(f"Wrote {OUT_BY_NC}")


if __name__ == "__main__":
    main()
