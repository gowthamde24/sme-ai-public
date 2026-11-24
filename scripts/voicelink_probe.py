#!/usr/bin/env python3
"""VoiceLink purchase-flow PROBE (C1, 28 Nov 2026): do the reseller purchase READS work for our account type? Nothing is locked, ordered or bought.

It calls four GET endpoints, nothing else: the wallet (reseller/profile), the DID types (reseller/did-types), and the numbers for sale of the Mobile and the Landline type (reseller/purchase/dids, one small page, with and
without a 'starts with' filter). It prints what answered (a status word), how many rows came back and the type names, never a password, a token or a full number (only the last 4 digits of the first row, to show the
shape). The login is typed at HIDDEN prompts (or taken from VOICELINK_USERNAME / VOICELINK_PASSWORD when set in your own shell), never from a file and never put on a command line.

  services/ai-api/.venv/bin/python scripts/voicelink_probe.py [--prefix 98]

Reading the answer: `did-types: ok` and `mobile: ok N rows` = the direct-purchase reads work and the picker can be built on them. A `refused` / `auth` word on purchase/dids = our plan does not include direct purchase:
send that line to the planner (the purchase would then go through VoiceLink's portal or a plan change)."""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))

from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError


def say(label: str, fn: object) -> object | None:
    try:
        value = fn()  # type: ignore[operator]
    except VoicelinkError as exc:
        print(f"{label}: {exc.reason}" + (f" (status {exc.status})" if getattr(exc, "status", None) else ""))
        return None
    return value


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--prefix", default="", help="digits the number starts with / contains, e.g. 98")
    args = p.parse_args(argv)
    user = os.environ.get("VOICELINK_USERNAME") or getpass.getpass("VoiceLink username (hidden): ")
    password = os.environ.get("VOICELINK_PASSWORD") or getpass.getpass("VoiceLink password (hidden): ")
    api = VoicelinkApi(user, password)
    wallet = say("login + wallet", api.wallet)
    if wallet is None:
        return 1
    print("login + wallet: ok")
    types = say("did-types", api.did_types)
    if types is not None:
        print("did-types: ok " + ", ".join(f"{t.get('id')}={t.get('name')}{' (request-required)' if t.get('requires_request') else ''}" for t in types))  # type: ignore[attr-defined]
    for name, did_type in (("mobile", 2), ("landline", 3)):
        rows = say(name, lambda t=did_type: api.available_dids(did_type=t, per_page=5))  # type: ignore[misc]
        if rows is not None:
            print(f"{name}: ok {len(rows)} rows" + (f", first ends ...{rows[0].number[-4:]}" if rows else ""))  # type: ignore[index,arg-type]
            if args.prefix:
                filtered = say(f"{name} starting {args.prefix}", lambda t=did_type: api.available_dids(did_type=t, prefix=args.prefix, per_page=5))  # type: ignore[misc]
                if filtered is not None:
                    print(f"{name} filter '{args.prefix}': ok {len(filtered)} rows")  # type: ignore[arg-type]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
