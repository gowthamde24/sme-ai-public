# ruff: noqa: E501
"""Money as people read it: rupees with the Indian grouping ("₹1,23,456"), paise only when there are some ("₹4.50"). The ledger counts paise (1 credit = ₹1 inside); NOTHING user-facing says "credits"."""

from __future__ import annotations


def group(rupees: int) -> str:
    s = str(abs(rupees))
    if len(s) <= 3:
        out = s
    else:
        head, tail = s[:-3], s[-3:]
        parts: list[str] = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        out = ",".join(parts) + "," + tail
    return ("-" if rupees < 0 else "") + out


def inr(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    p = abs(int(paise))
    whole, frac = divmod(p, 100)
    body = group(whole) + (f".{frac:02d}" if frac else "")
    return f"{sign}₹{body}"


def minutes_text(minutes: int) -> str:
    return f"about {group(minutes)} call minute" + ("" if minutes == 1 else "s")
