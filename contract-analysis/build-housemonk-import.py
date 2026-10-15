"""Combine HouseMonk tenancy and invoice exports into a Mews customers CSV."""
import argparse
import csv
import re
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "External Data Sources"
TENANCY = ROOT / "Tenancy-14-10-2026-044225.csv"
INVOICE = ROOT / "Invoice-CreditNote-Pro Forma Invoice-14-10-2026-044357.csv"
WORKBOOK_HEADERS = [
    "Email",
    "Last Name(*)",
    "First Name",
    "Second Last Name",
    "Nationality Code",
    "Birth Date",
    "Birth Place",
    "Telephone",
    "Document Type",
    "Document Number",
    "Document Expiry Date",
    "Document Issue Date",
    "Address Line 1",
    "Address Line 2",
    "City",
    "Postal Code",
    "Country Code",
    "Internal Guest Notes",
    "Preferred Space Features",
    "Company Id",
    "Tax Identification Number",
    "Accounting Code",
    "Billing Code",
    "Invoiceable",
    "Checkin Date(*)",
    "Arrival Date",
    "Checkout Date(*)",
    "Departure Date",
    "Person Counts(*)",
    "Adult Count(*)",
    "Child Count(*)",
    "Booker ID",
    "Companions",
    "Reservation Notes",
    "Confirmation Code",
    "Group Code",
    "Currency Code",
    "Total Price",
    "monthly or nightly",
    "Per Night /month Prices",
    "Prepaid Amount",
    "Prepayment Type",
    "Allocated Room Category(*)",
    "Allocated Room Number",
    "Allocated Rate",
    "Included Products",
    "Partner Company",
    "Channel manager number",
    "Channel number",
    "Channel manager integration ID",
    "Source",
]
OUT = ROOT / "HouseMonk_data_14.10.2026.csv"
CURRENT_OUT = ROOT / "Current Housemonk data 15.10.2026.csv"

COUNTRIES = {
    "spain": "ES",
    "españa": "ES",
    "mexico": "MX",
    "méxico": "MX",
    "germany": "DE",
    "france": "FR",
    "italy": "IT",
    "portugal": "PT",
    "united kingdom": "GB",
    "uk": "GB",
    "colombia": "CO",
    "argentina": "AR",
    "brazil": "BR",
    "brasil": "BR",
    "united states": "US",
    "usa": "US",
    "netherlands": "NL",
    "belgium": "BE",
    "romania": "RO",
    "poland": "PL",
    "morocco": "MA",
    "china": "CN",
    "india": "IN",
}


def clean(value):
    return (value or "").strip()


def parse_date(value):
    value = clean(value)
    if not value:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value[:10]) and len(value) >= 10 and value[4] == "-":
        return value[:10]
    match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", value)
    if not match:
        return ""
    day, month, year = (int(part) for part in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def days_between(start, end):
    if not start or not end:
        return ""
    try:
        delta = datetime.fromisoformat(end) - datetime.fromisoformat(start)
    except ValueError:
        return ""
    if delta.days < 0:
        return ""
    return str(delta.days)


def number(value):
    text = clean(value).replace(" ", "")
    if not text:
        return None
    text = text.replace(",", ".") if text.count(",") == 1 and "." not in text else text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def money(value):
    if isinstance(value, (int, float)):
        amount = float(value)
    else:
        amount = number(value)
    if amount is None:
        return ""
    if abs(amount - round(amount)) < 0.001:
        return str(int(round(amount)))
    return f"{amount:.2f}"


def split_name(full):
    parts = clean(full).split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return "", parts[0]
    return parts[0], " ".join(parts[1:])


def country_code(value):
    text = clean(value)
    if re.fullmatch(r"[A-Za-z]{2}", text):
        return text.upper()
    return COUNTRIES.get(text.lower(), "")


def document_type(value):
    text = clean(value).lower()
    if "passport" in text or "pasaport" in text:
        return "Passport"
    if any(token in text for token in ("dni", "nie", "cif", "identity")):
        return "IdentityCard"
    return ""


def nc_code(value):
    match = re.search(r"(\d+)", clean(value))
    if not match:
        return ""
    return f"NC_{int(match.group(1))}"


def product_kind(name):
    text = name.lower()
    if "parking" in text:
        return "Parking"
    if any(token in text for token in ("desayuno", "comida", "menú", "menu", "pensión", "pension", "all in")):
        return "Meal plan"
    return "Extra"


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_email(value):
    return clean(value).lower()


def normalize_id(value):
    return re.sub(r"[\s\-]", "", clean(value)).upper()


def index_invoices(invoices):
    by_contract = defaultdict(list)
    by_email = defaultdict(list)
    by_id = defaultdict(list)
    for row in invoices:
        contract_id = clean(row.get("Contract ID"))
        if contract_id:
            by_contract[contract_id].append(row)
        email = normalize_email(row.get("User Email"))
        if email:
            by_email[email].append(row)
        doc_id = normalize_id(row.get("ID"))
        if doc_id:
            by_id[doc_id].append(row)
    return by_contract, by_email, by_id


def invoice_rows_for_tenancy(row, by_contract, by_email, by_id):
    contract_id = clean(row.get("Contract ID"))
    if contract_id and contract_id in by_contract:
        return by_contract[contract_id]
    matched = []
    seen_keys = set()
    email = normalize_email(row.get("Tenant Email"))
    tenant_id = normalize_id(row.get("Tenant ID"))
    for item in by_email.get(email, []) + by_id.get(tenant_id, []):
        key = (
            clean(item.get("Transaction ID")),
            clean(item.get("Line Item Name")),
            clean(item.get("Line Item Billed At")),
            clean(item.get("Line Item Amount")),
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        matched.append(item)
    return matched


def tenancy_end_date(row):
    return parse_date(row.get("Contract End Date")) or parse_date(row.get("Move out date"))


def is_current_or_future_tenancy(row, as_of: date):
    end = tenancy_end_date(row)
    if end:
        return end >= as_of.isoformat()
    status = clean(row.get("Tenancy Status")).lower()
    if status in {"occupied", "booked", "shifted"}:
        return True
    return False


def invoice_profile(items):
    extras = defaultdict(float)
    address = {}
    for item in items:
        sign = -1 if clean(item.get("Transaction Type")) == "CreditNote" else 1
        name = clean(item.get("Line Item Name"))
        amount = number(item.get("Line Item Amount")) or 0
        if name and name.lower() != "tarifa":
            extras[name] += sign * amount
        if not address and clean(item.get("User Address")):
            address = {
                "Address Line 1": clean(item.get("User Address")),
                "City": clean(item.get("User City")),
                "Postal Code": clean(item.get("User Postal Code")),
                "Country Code": country_code(item.get("User Country")),
                "Nationality Code": country_code(item.get("Nationality")),
                "Document Type": document_type(item.get("Type of ID")),
                "Document Number": clean(item.get("ID")),
                "Document Expiry Date": parse_date(item.get("ID Expiry Date")),
            }
    return extras, address


def latest_reservation_per_guest(rows):
    """Keep the latest stay for each document number. Blank IDs are not merged."""
    best = {}
    no_id = []
    for row in rows:
        document_id = clean(row.get("Document Number")).lower()
        if not document_id:
            no_id.append(row)
            continue
        current = best.get(document_id)
        rank = (row.get("Checkin Date(*)") or "", row.get("Checkout Date(*)") or "")
        if current is None or rank >= current[0]:
            best[document_id] = (rank, row)
    kept = [item[1] for item in best.values()] + no_id
    kept.sort(key=lambda row: (row.get("Checkin Date(*)") or "", row.get("Last Name(*)") or ""))
    return kept


def build_output_rows(tenancy, invoices, *, as_of: date | None = None, current_only: bool = False):
    kept = list(tenancy)
    if current_only and as_of:
        kept = [row for row in kept if is_current_or_future_tenancy(row, as_of)]

    by_contract = defaultdict(list)
    for row in kept:
        contract_id = clean(row["Contract ID"])
        if contract_id:
            by_contract[contract_id].append(row)

    invoices_by_contract, invoices_by_email, invoices_by_id = index_invoices(invoices)

    output_rows = []
    for row in kept:
        contract_id = clean(row["Contract ID"])
        companions = []
        company_name = ""
        if contract_id:
            for other in by_contract[contract_id]:
                other_name = clean(other["Tenant Name"])
                if other is row:
                    if "company" in clean(other["Tenant Type"]).lower() and not company_name:
                        company_name = other_name
                    continue
                if "company" in clean(other["Tenant Type"]).lower() and not company_name:
                    company_name = other_name
                elif other_name and other_name != clean(row["Tenant Name"]):
                    companions.append(other_name)
        if "company" in clean(row["Tenant Type"]).lower():
            company_name = clean(row["Tenant Name"])

        extras, profile = invoice_profile(
            invoice_rows_for_tenancy(row, invoices_by_contract, invoices_by_email, invoices_by_id),
        )
        charge_name = clean(row["Additional Charge"])
        charge_amount = number(row["Additional Charge Amount"])
        if charge_name and charge_name not in extras and charge_amount:
            extras[charge_name] = charge_amount

        products = []
        for name, amount in sorted(extras.items()):
            if abs(amount) < 0.005:
                continue
            products.append(f"{product_kind(name)}: {name} ({money(amount)})")

        checkin = parse_date(row["Contract Start Date"]) or parse_date(row["Occupancy Date"])
        checkout = parse_date(row["Contract End Date"])
        move_out = parse_date(row["Move out date"])
        stay_days = days_between(checkin, checkout)
        notes = []
        if stay_days:
            notes.append(f"Tenancy length: {stay_days} days")
        if clean(row["Tenancy Status"]):
            notes.append(f"Status: {clean(row['Tenancy Status'])}")
        if move_out and move_out != checkout:
            notes.append(f"Move out: {move_out}")
        for key in (
            "Promotions New",
            "Promotions for reporting",
            "Forma de pago y clausulas extras Description1",
            "Forma de pago y clausulas extras Description2",
            "Forma de pago y clausulas extras Description3",
        ):
            if clean(row.get(key)):
                notes.append(clean(row[key]))

        people = number(row["No of Tenants"])
        people_count = str(int(people)) if people and people >= 1 else "1"
        first, last = split_name(row["Tenant Name"])
        if company_name and clean(row["Tenant Name"]) == company_name:
            first, last = "", company_name
        if not last:
            last = clean(row["Tenant Name"]) or "Guest"

        nc = nc_code(row.get("NC"))
        contract_type = clean(row["Contract Type"]).lower()
        record = {header: "" for header in WORKBOOK_HEADERS}
        record["Email"] = clean(row["Tenant Email"])
        record["Last Name(*)"] = last
        record["First Name"] = first
        record["Telephone"] = clean(row["Tenant Phone Number"])
        record["Document Number"] = profile.get("Document Number") or clean(row["Tenant ID"])
        record["Document Type"] = profile.get("Document Type", "")
        record["Document Expiry Date"] = profile.get("Document Expiry Date", "")
        record["Address Line 1"] = profile.get("Address Line 1", "")
        record["City"] = profile.get("City", "")
        record["Postal Code"] = profile.get("Postal Code", "")
        record["Country Code"] = profile.get("Country Code", "")
        record["Nationality Code"] = profile.get("Nationality Code", "")
        record["Internal Guest Notes"] = nc
        record["Company Id"] = company_name
        record["Checkin Date(*)"] = checkin
        record["Checkout Date(*)"] = checkout
        record["Person Counts(*)"] = people_count
        record["Adult Count(*)"] = people_count
        record["Child Count(*)"] = "0"
        record["Companions"] = "; ".join(dict.fromkeys(companions))
        record["Reservation Notes"] = " | ".join(notes)
        record["Group Code"] = nc
        record["Currency Code"] = "EUR"
        record["Total Price"] = money(row["Tenant Total Rent"])
        record["monthly or nightly"] = contract_type
        record["Per Night /month Prices"] = money(row["Tenant Rent"])
        record["Prepaid Amount"] = money(row["Deposit"])
        record["Allocated Room Category(*)"] = clean(row["Unit Category"])
        record["Allocated Room Number"] = clean(row["Door"])
        record["Allocated Rate"] = money(row["Tenant Rent"])
        record["Included Products"] = "; ".join(products)
        record["Partner Company"] = company_name
        record["Channel number"] = contract_id
        record["Source"] = "HouseMonk"
        output_rows.append(record)

    before = len(output_rows)
    output_rows = latest_reservation_per_guest(output_rows)
    return output_rows, before


def write_output(path, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=WORKBOOK_HEADERS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description="Build HouseMonk → Mews import CSV from tenancy + invoice exports.")
    parser.add_argument("--output", type=Path, default=OUT, help="Output CSV path")
    parser.add_argument(
        "--current-only",
        action="store_true",
        help="Keep only stays ending on or after --as-of (exclude past reservations).",
    )
    parser.add_argument("--as-of", default="2026-10-15", help="Reference date (YYYY-MM-DD) for current/future filter")
    args = parser.parse_args()
    as_of = datetime.strptime(args.as_of, "%Y-%m-%d").date()

    tenancy = read_rows(TENANCY)
    invoices = read_rows(INVOICE)
    output_rows, before_dedupe = build_output_rows(
        tenancy,
        invoices,
        as_of=as_of,
        current_only=args.current_only,
    )

    write_output(args.output, output_rows)
    removed = before_dedupe - len(output_rows)
    label = "current/future" if args.current_only else "all"
    print(f"wrote {len(output_rows)} rows ({label}) to {args.output} ({removed} duplicate stays removed by guest ID)")
    print(Counter(row["Allocated Room Category(*)"] for row in output_rows).most_common(8))


if __name__ == "__main__":
    main()
