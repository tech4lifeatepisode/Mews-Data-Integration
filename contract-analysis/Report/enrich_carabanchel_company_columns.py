"""
Insert two columns after F on the Carabanchel invoices sheet:
  - "Company Name" (Yes/No): company vs person from User Name via OpenAI
  - "Company ID" (Yes/No): Spain B-prefix CIF-style rule on "DNI from Tenancy Report"

Requires: xlwings, openai, Excel installed.

API key MUST be set as environment variable OPENAI_API_KEY (never commit keys).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

import xlwings as xw
from dotenv import load_dotenv
from openai import OpenAI

WORKBOOK_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "Invocies comparison to Guest Report 24.12.25 to 24.04.26.xlsx",
)


MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.2-2025-12-11")
BATCH = 140


def read_vertical_cells(value: object) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        if not value:
            return []
        if isinstance(value[0], list):
            return [row[0] if row else None for row in value]
        return value
    return [value]


def load_env_file(env_path: str) -> None:
    """Robust .env loader that tolerates spaces and UTF-8 BOM."""
    if not os.path.isfile(env_path):
        return
    with open(env_path, "r", encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip().lstrip("\ufeff")
            val = v.strip().strip('"').strip("'")
            if key:
                os.environ[key] = val


def find_sheet(book) -> object:
    for name in book.sheet_names:
        low = name.lower()
        if all(s in low for s in ("carabanchel", "hotel")) and "long" in low:
            return book.sheets[name]
    raise RuntimeError("Could not find Carabanchel sheet (expected name like Carabanchel Hotel and Long Stay).")


def classify_b_prefix_cif(value: object) -> str:
    """
    Rule from user instruction (B-prefix slice only).
    Starts with B; last character digit -> counts as company ID (Yes for 'Company ID').
    Starts with B; last character letter -> person / not company ID pattern (No).
    Other prefixes: not a company ID under this rule -> No (non-empty IDs).
    """
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    fragments = [p.strip() for p in re.split(r"\|", s) if p.strip()]
    if not fragments:
        return ""

    def frag_is_company(pat: str) -> bool | None:
        if not pat.upper().startswith("B"):
            return None
        last = pat[-1]
        if last.isdigit():
            return True
        if last.isalpha():
            return False
        return None

    has_company = False
    has_b_negative = False
    has_b_unknown = False
    for frag in fragments:
        r = frag_is_company(frag)
        if r is True:
            has_company = True
        elif r is False:
            has_b_negative = True
        else:
            if frag.upper().startswith("B"):
                has_b_unknown = True

    if has_company:
        return "Yes"
    if has_b_negative or has_b_unknown:
        return "No"
    return "No"


def _parse_json_object(text: str) -> dict:
    text = text.strip()
    m = re.search(r"\{[\s\S]*\}\s*", text)
    if m:
        text = m.group(0)
    return json.loads(text)


def classify_names_via_openai(unique_names: list[str], client: OpenAI) -> dict[str, str]:
    """Map exact name -> Yes | No."""

    uniq: list[str] = []
    seen: set[str] = set()
    for n in unique_names:
        key = str(n).strip() if n is not None else ""
        if not key or key in seen:
            continue
        seen.add(key)
        uniq.append(key)

    result: dict[str, str] = {}

    system = (
        "You classify whether each display name is more likely a legal entity/company name "
        "or an individual person's name, using only the text of the name.\n"
        'Reply with a single JSON object: {"results": [{"name": "<exact>", "answer": "Yes"|"No"}, ...]}\n'
        'Use "Yes" if it is more likely a company (e.g. contains SL, S.L., S.A., Ltd, Holdings, '
        "Agency, Group, brand-style business names, institutions). "
        'Use "No" for typical personal given name + surname patterns.\n'
        "If ambiguous, answer No.\n"
        "The `name` field must match the input string exactly for each item."
    )

    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i : i + BATCH]
        user = json.dumps({"names": chunk}, ensure_ascii=False)
        last_err: Exception | None = None
        for model in (MODEL, "gpt-4o-mini"):
            try:
                resp = client.chat.completions.create(
                    model=model,
                    temperature=0,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                )
                choice = resp.choices[0].message.content or "{}"
                data = _parse_json_object(choice)
                items = data.get("results")
                if not isinstance(items, list):
                    raise ValueError("Missing results list")
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    nm = str(item.get("name", "")).strip()
                    ans = str(item.get("answer", "")).strip().capitalize()
                    if ans not in ("Yes", "No"):
                        ans = "No"
                    if nm:
                        result[nm] = ans
                break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(1.5)
        else:
            raise RuntimeError(f"OpenAI batch failed: {last_err}") from last_err
    for nm in uniq:
        result.setdefault(nm, "No")
    return result


def main() -> None:
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(env_path)
    load_env_file(env_path)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        print("Set OPENAI_API_KEY in the environment, then re-run.", file=sys.stderr)
        sys.exit(1)

    path = WORKBOOK_PATH
    if not os.path.isfile(path):
        print(f"Workbook not found: {path}", file=sys.stderr)
        sys.exit(1)

    app = xw.App(visible=False)
    wb = None
    try:
        wb = app.books.open(path)
        sh = find_sheet(wb)

        g1 = sh.range("G1").value
        h1 = sh.range("H1").value
        g1s = (g1 or "").strip() if isinstance(g1, str) else ""
        h1s = (h1 or "").strip() if isinstance(h1, str) else ""

        need_insert = g1s != "Company Name" or h1s != "Company ID"

        last_row = sh.range((1048576, 6)).end("up").row
        if last_row < 2:
            print("No data rows found.", file=sys.stderr)
            sys.exit(1)

        row_count = last_row - 1

        flat_names = read_vertical_cells(sh.range(f"F2:F{last_row}").value)
        if need_insert:
            flat_dnis = read_vertical_cells(sh.range(f"J2:J{last_row}").value)
            sh.api.Columns(7).Insert()
            sh.api.Columns(7).Insert()
            sh.range("G1").value = "Company Name"
            sh.range("H1").value = "Company ID"
        else:
            flat_dnis = read_vertical_cells(sh.range(f"L2:L{last_row}").value)

        if len(flat_names) < row_count:
            flat_names.extend([None] * (row_count - len(flat_names)))
        if len(flat_dnis) < row_count:
            flat_dnis.extend([None] * (row_count - len(flat_dnis)))
        flat_names = flat_names[:row_count]
        flat_dnis = flat_dnis[:row_count]

        client = OpenAI(api_key=api_key)
        uniq_for_api = sorted({str(n).strip() for n in flat_names if n and str(n).strip()})
        print(f"classifying {len(uniq_for_api)} unique names with model {MODEL!r} (fallback gpt-4o-mini)...")
        name_map = classify_names_via_openai(uniq_for_api, client)

        out_company: list[list[str]] = []
        out_id: list[list[str]] = []
        for i in range(row_count):
            nm = flat_names[i]
            key = str(nm).strip() if nm is not None else ""
            y_n = name_map.get(key, "No") if key else ""
            out_company.append([y_n if y_n else ""])
            out_id.append([classify_b_prefix_cif(flat_dnis[i])])

        sh.range(f"G2:G{last_row}").value = out_company
        sh.range(f"H2:H{last_row}").value = out_id

        wb.save(path)
        print(f"Updated {path} ({row_count} rows).")
    finally:
        if wb is not None:
            wb.close()
        app.quit()


if __name__ == "__main__":
    main()
