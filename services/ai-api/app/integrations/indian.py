"""Indian formats for the files we write: rupees from integer paise (never a float), dates as DD/MM/YYYY (what Indian spreadsheets and Vyapar use) and YYYYMMDD (Tally)."""

from __future__ import annotations

from datetime import date


def rupees(paise: int) -> str:
    """1180 paise-integer -> '11.80'; plain digits, a dot and two decimals, no symbol and no grouping, so a spreadsheet reads it as a number. Negative amounts keep their sign."""
    sign = "-" if paise < 0 else ""
    whole, frac = divmod(abs(int(paise)), 100)
    return f"{sign}{whole}.{frac:02d}"


def rupees_indian(paise: int) -> str:
    """For people to read: Indian digit grouping with the rupee sign, '₹1,18,000.00'."""
    sign = "-" if paise < 0 else ""
    whole, frac = divmod(abs(int(paise)), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    return f"{sign}₹{digits}.{frac:02d}"


def dmy(day: date | str) -> str:
    """'2026-10-05' or a date -> '05/10/2026'."""
    d = day if isinstance(day, date) else date.fromisoformat(day)
    return f"{d.day:02d}/{d.month:02d}/{d.year:04d}"


def tally_date(day: date | str) -> str:
    """'2026-10-05' -> '20261005' (Tally's voucher date)."""
    d = day if isinstance(day, date) else date.fromisoformat(day)
    return f"{d.year:04d}{d.month:02d}{d.day:02d}"


def percent(bps: int) -> str:
    """250 -> '2.5', 500 -> '5', 1200 -> '12' (a rate in basis points, written the way a ledger is named)."""
    whole, frac = divmod(int(bps), 100)
    if frac == 0:
        return str(whole)
    text = f"{whole}.{frac:02d}".rstrip("0")
    return text
