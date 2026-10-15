"""Map HouseMonk / Seguimiento CSVs to Customers_Contracts_Extraction column layout."""
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "External Data Sources"

# Same order as contract-extraction/extraction sandbox/sandbox-common.mjs → CUSTOMER_HEADERS
CUSTOMER_HEADERS = [
    "Email",
    "Last Name(*)",
    "First Name",
    "Second Last Name",
    "Title",
    "Sex",
    "Nationality Code",
    "Preferred Language Code",
    "Birth Date",
    "Birth Place",
    "Telephone",
    "Document Type",
    "Document Number",
    "Document Expiry Date",
    "Document Issue Date",
    "Document Issuing Country Code",
    "Document Issuing Country Subdivision Code",
    "Document Issuing City",
    "Document Support Number",
    "Occupation",
    "Car Registration Number",
    "Address Line 1",
    "Address Line 2",
    "City",
    "Postal Code",
    "Country Code",
    "Country Subdivision Code",
    "Customer Classification",
    "Internal Guest Notes",
    "Preferred Space Features",
    "Dietary Requirements",
    "Loyalty Code",
    "Company Id",
    "Tax Identification Number",
    "Accounting Code",
    "Billing Code",
    "Italian Destination Code",
    "Italian Fiscal Code",
    "Italian Lottery Code",
    "Invoiceable",
    "Process ID Image",
    "Process Verification Photo",
    "Send Marketing Emails",
    "Send Marketing Postal Mail",
    "Send Partner Marketing Emails",
    "Send Partner Marketing Postal Mail",
    "Arrival Date(*)",
    "Arrival Time",
    "Departure Date(*)",
    "Departure Time",
    "Person Counts(*)",
    "Adult Count(*)",
    "Child Count(*)",
    "Booker ID",
    "Companions",
    "Reservation Notes",
    "Confirmation Code",
    "Group Code",
    "Voucher Code",
    "Availability Block ID",
    "Currency Code",
    "Total Price",
    "Per Night Prices",
    "Prepaid Amount",
    "Prepayment Type",
    "Skip Automatic Settlement",
    "Allocated Room Category(*)",
    "Allocated Room Number",
    "Allocated Rate",
    "Included Products",
    "Partner Company",
    "Travel Agency",
    "Business Segment",
    "Reservation Purpose",
    "Release Date",
    "Channel manager number",
    "Channel number",
    "Channel manager integration ID",
    "Source",
]

# Optional Supabase columns on Customers_Contracts_Extraction_12_10_2026 (blank for these imports)
EXTRA_TABLE_COLUMNS = ["storage_path", "drive_upload_id", "source_document"]

OUTPUT_HEADERS = CUSTOMER_HEADERS + EXTRA_TABLE_COLUMNS


def blank_record():
    return {header: "" for header in OUTPUT_HEADERS}


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
        return value
    day, month, year = (int(part) for part in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_money(value):
    text = clean(value)
    if not text:
        return ""
    text = text.replace("€", "").replace(" ", "")
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        amount = float(text)
    except ValueError:
        return clean(value)
    if abs(amount - round(amount)) < 0.001:
        return str(int(round(amount)))
    return f"{amount:.2f}"


def join_notes(*parts):
    bits = [clean(part) for part in parts if clean(part)]
    return " | ".join(bits)


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_HEADERS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def map_housemonk(row):
    record = blank_record()
    direct = {
        "Email": "Email",
        "Last Name(*)": "Last Name(*)",
        "First Name": "First Name",
        "Second Last Name": "Second Last Name",
        "Nationality Code": "Nationality Code",
        "Birth Date": "Birth Date",
        "Birth Place": "Birth Place",
        "Telephone": "Telephone",
        "Document Type": "Document Type",
        "Document Number": "Document Number",
        "Document Expiry Date": "Document Expiry Date",
        "Document Issue Date": "Document Issue Date",
        "Address Line 1": "Address Line 1",
        "Address Line 2": "Address Line 2",
        "City": "City",
        "Postal Code": "Postal Code",
        "Country Code": "Country Code",
        "Internal Guest Notes": "Internal Guest Notes",
        "Preferred Space Features": "Preferred Space Features",
        "Company Id": "Company Id",
        "Tax Identification Number": "Tax Identification Number",
        "Accounting Code": "Accounting Code",
        "Billing Code": "Billing Code",
        "Invoiceable": "Invoiceable",
        "Person Counts(*)": "Person Counts(*)",
        "Adult Count(*)": "Adult Count(*)",
        "Child Count(*)": "Child Count(*)",
        "Booker ID": "Booker ID",
        "Companions": "Companions",
        "Confirmation Code": "Confirmation Code",
        "Group Code": "Group Code",
        "Currency Code": "Currency Code",
        "Total Price": "Total Price",
        "Prepaid Amount": "Prepaid Amount",
        "Prepayment Type": "Prepayment Type",
        "Allocated Room Category(*)": "Allocated Room Category(*)",
        "Allocated Room Number": "Allocated Room Number",
        "Allocated Rate": "Allocated Rate",
        "Included Products": "Included Products",
        "Partner Company": "Partner Company",
        "Channel manager number": "Channel manager number",
        "Channel number": "Channel number",
        "Channel manager integration ID": "Channel manager integration ID",
        "Source": "Source",
    }
    for target, source in direct.items():
        record[target] = clean(row.get(source))

    record["Arrival Date(*)"] = parse_date(row.get("Checkin Date(*)") or row.get("Arrival Date"))
    record["Departure Date(*)"] = parse_date(row.get("Checkout Date(*)") or row.get("Departure Date"))
    record["Per Night Prices"] = clean(row.get("Per Night /month Prices") or row.get("Per Night Prices"))
    record["Reservation Notes"] = join_notes(
        row.get("Reservation Notes"),
        f"Billing: {row.get('monthly or nightly')}" if clean(row.get("monthly or nightly")) else "",
    )
    if not record["Source"]:
        record["Source"] = "HouseMonk"
    if not record["Group Code"] and clean(row.get("Internal Guest Notes")):
        record["Group Code"] = clean(row.get("Internal Guest Notes"))
    return record


def map_seguimiento(row):
    record = blank_record()
    category = clean(row.get("Category"))
    first = clean(row.get("1st Client Name"))
    last = clean(row.get("Last Name"))
    second_first = clean(row.get("2nd Client Name"))
    second_last = clean(row.get("Last Name ", "") or row.get("Last Name"))
    guarantor = clean(row.get("Guarantor"))

    if category.upper().startswith("B2B") and first and not last:
        record["Company Id"] = first
        record["Last Name(*)"] = first
    else:
        record["First Name"] = first
        record["Last Name(*)"] = last or first

    if second_first or second_last:
        record["Second Last Name"] = second_last
        companion = " ".join(part for part in (second_first, second_last) if part)
        if companion:
            record["Companions"] = companion

    if guarantor:
        record["Partner Company"] = guarantor
        if not record["Companions"]:
            record["Companions"] = guarantor
        elif guarantor not in record["Companions"]:
            record["Companions"] = join_notes(record["Companions"], guarantor)

    record["Group Code"] = clean(row.get("Unique code"))
    record["Business Segment"] = category
    record["Arrival Date(*)"] = parse_date(row.get("Contract Start"))
    record["Departure Date(*)"] = parse_date(row.get("Move-Out") or row.get("Original Check-Out"))
    residents = clean(row.get("# Residents")) or "1"
    record["Person Counts(*)"] = residents
    record["Adult Count(*)"] = residents
    record["Child Count(*)"] = "0"
    record["Currency Code"] = "EUR"
    record["Total Price"] = parse_money(row.get("Total RI"))
    record["Per Night Prices"] = parse_money(row.get("Headline Rent per month") or row.get("Mth RI"))
    record["Prepaid Amount"] = parse_money(row.get("Deposit  €") or row.get("Deposit  €"))
    record["Allocated Room Category(*)"] = clean(row.get("Unit Type"))
    record["Allocated Rate"] = parse_money(row.get("Headline Rent per month"))
    record["Reservation Notes"] = join_notes(
        clean(row.get("Comentarios")),
        f"Status: {clean(row.get('Label'))}" if clean(row.get("Label")) else "",
        clean(row.get("RENOVATION/UPGRADE")),
        f"After renovation: {clean(row.get('NC - After Renovation'))}" if clean(row.get("NC - After Renovation")) else "",
        f"Owner: {clean(row.get('OWNER'))}" if clean(row.get("OWNER")) else "",
    )
    record["Internal Guest Notes"] = record["Group Code"]
    record["Channel number"] = clean(row.get("Deal ID (Hbt=Hsk)"))
    record["Source"] = "Seguimiento Leasing"
    return record


def convert(in_path: Path, mapper, out_path: Path):
    rows = [mapper(row) for row in read_csv(in_path)]
    write_csv(out_path, rows)
    return len(rows)


def main():
    jobs = [
        (
            ROOT / "Current Housemonk data 15.10.2026.csv",
            map_housemonk,
            ROOT / "Final Format_Current Housemonk data 15.10.2026.csv",
        ),
        (
            ROOT / "Current Seguirmento data 15.10.2026.csv",
            map_seguimiento,
            ROOT / "Final Format_Current Seguirmento data 15.10.2026.csv",
        ),
    ]
    for in_path, mapper, out_path in jobs:
        count = convert(in_path, mapper, out_path)
        print(f"wrote {count} rows -> {out_path.name}")


if __name__ == "__main__":
    main()
