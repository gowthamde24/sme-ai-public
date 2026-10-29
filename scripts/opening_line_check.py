"""ONE opening line, checked on staging through the API as each seeded DEMO owner (synthetic workspaces): for every language the card (GET /opening-line .resolved), GET /opening-line/resolved, /opening-line/preview,
the settings preview and (with --hear, a few characters of voice credit) "Hear it" return the SAME text, and no retired persona name or hard-coded owner/city name is in it.

Prints only pass/fail per workspace and language, never a token or a response body.

  python3 scripts/opening_line_check.py --api-url https://sme-api-620338396268.asia-south1.run.app [--hear te,en]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "services" / "ai-api"))
import seed_staging as S

LANGS = ("te", "en", "hi", "kn", "ta", "ml")
RETIRED = re.compile(r"\b(Tara|Vani|Vijaya|Vijay|Gowtham|Dharmavaram)\b")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--hear", default="", help="languages to also speak with Hear it (voice credit), e.g. te,en; only for the first workspace")
    args = ap.parse_args()
    seeder = S.Seeder(args.api_url.rstrip("/"))
    hear = [x for x in args.hear.split(",") if x]
    failures = 0
    terms = seeder.terms()
    for index, (pack, _name, language) in enumerate(S.BUSINESSES):
        email = f"demo-{pack.replace('_', '-')}@{S.DEMO_DOMAIN}"
        token = seeder.second_factor(pack, seeder.sign_in(email, S.secret_get(f"sme-demo-{pack}-password") or ""))
        st, setup = seeder.call(token, "POST", "/v1/account/setup", {"business_type": pack, "language": language, "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})   # (idempotent: answers the existing workspace)
        tenant = str(setup["tenant_id"]) if st == 200 and isinstance(setup, dict) and setup.get("tenant_id") else None
        if tenant is None:
            print(f"{pack}: FAIL could not find the workspace")
            failures += 1
            continue

        def get(path: str, tenant: str = tenant, token: str = token) -> Any:
            code, body = seeder.call(token, "GET", f"/v1/tenants/{tenant}{path}")
            if code != 200:
                raise RuntimeError(f"GET {path}: {code}")
            return body

        card = get("/ai-assistant/opening-line")["resolved"]
        for lang in LANGS:
            texts = {
                "card": card[lang]["resolved_opening_line"],
                "resolved": get(f"/ai-assistant/opening-line/resolved?language={lang}")["resolved_opening_line"],
                "preview": get(f"/ai-assistant/opening-line/preview?language={lang}")["text"],
                "settings preview": get(f"/ai-assistant/preview?language={lang}&style=warm")["text"],
            }
            if index == 0 and lang in hear:
                code, body = seeder.call(token, "POST", f"/v1/tenants/{tenant}/ai-assistant/voices/preview", {"language": lang})
                if code == 200 and isinstance(body, dict):
                    texts["hear it"] = body["spoken_text"]
                else:
                    texts["hear it"] = f"<status {code}>"
            same = len(set(texts.values())) == 1
            clean = not any(RETIRED.search(t) for t in texts.values())
            ok = same and clean
            failures += 0 if ok else 1
            print(f"{pack:24s} {lang}: {'PASS' if ok else 'FAIL'} ({len(texts)} surfaces{', hear it' if 'hear it' in texts else ''}; same={same} clean={clean})")
    print("ALL PASS" if failures == 0 else f"{failures} FAILED")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
