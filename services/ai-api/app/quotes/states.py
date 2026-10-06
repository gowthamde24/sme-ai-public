"""The real list of Indian state and union-territory codes: ISO 3166-2:IN, 28 states and 8 union territories (36 codes).

`delivery_state` of a quote is one of these (the API validates it; the database only checks two capital letters: docs/pre-pilot-checklist.md, "Quotes"). The codes are the ISO ones,
not the vehicle-registration abbreviations (Telangana is TG, not TS; Uttarakhand UT, not UK; Odisha OD). A person picks a NAME; the code is stored. The list is a fact about
geography, not tax advice: which tax applies to which state is the owner's and the accountant's input."""

from __future__ import annotations

STATES: dict[str, str] = {
    "AP": "Andhra Pradesh", "AR": "Arunachal Pradesh", "AS": "Assam", "BR": "Bihar", "CG": "Chhattisgarh", "GA": "Goa",
    "GJ": "Gujarat", "HR": "Haryana", "HP": "Himachal Pradesh", "JH": "Jharkhand", "KA": "Karnataka", "KL": "Kerala",
    "MP": "Madhya Pradesh", "MH": "Maharashtra", "MN": "Manipur", "ML": "Meghalaya", "MZ": "Mizoram", "NL": "Nagaland",
    "OD": "Odisha", "PB": "Punjab", "RJ": "Rajasthan", "SK": "Sikkim", "TN": "Tamil Nadu", "TG": "Telangana",
    "TR": "Tripura", "UP": "Uttar Pradesh", "UT": "Uttarakhand", "WB": "West Bengal",
}  # fmt: skip
UNION_TERRITORIES: dict[str, str] = {
    "AN": "Andaman and Nicobar Islands", "CH": "Chandigarh", "DH": "Dadra and Nagar Haveli and Daman and Diu", "DL": "Delhi",
    "JK": "Jammu and Kashmir", "LA": "Ladakh", "LD": "Lakshadweep", "PY": "Puducherry",
}  # fmt: skip
ALL_CODES: dict[str, str] = {**STATES, **UNION_TERRITORIES}


def is_state_code(value: object) -> bool:
    return isinstance(value, str) and value in ALL_CODES
