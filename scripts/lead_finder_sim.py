"""Lead Finder part C: the simulated qualifying calls, written out for a person to read (ADR 0119).

6 retailer personas x 2 business types (the two packs that have a lead_finder.json) x te/en = 24 calls, our scripted assistant against a scripted persona. No model, no telephony, no network, no cost.
Each call is one Markdown file (the transcript with seconds, the captured answers, the summary, the outcome, every eval) plus index.md with the table of results.

  services/ai-api/.venv/bin/python scripts/lead_finder_sim.py ~/Desktop/stack19-jobs/lead-finder-check/calls

Exit code 0 only when every eval of every call passed and every outcome is the expected one."""

# ruff: noqa: E501
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-api"))

from app.lead_finder import packdata, qualify  # noqa: E402
from app.lead_finder.service import stock_lines  # noqa: E402

# INVENTED catalogues (the same as the tests'): two in stock with a price, one without a set price or few left, one made to order
STOCK = {
    "textile": [
        {"name": "Kanchi Pattu Bridal", "fabric": "kanchi_pattu", "occasions": ["wedding"], "price_paise": 850000, "stock_status": "in_stock", "sell_unit": "piece"},
        {"name": "Dharmavaram Silk Classic", "fabric": "dharmavaram_silk", "occasions": ["festival"], "price_paise": 450000, "stock_status": "in_stock", "sell_unit": "piece"},
        {"name": "Soft Silk Daily", "fabric": "soft_silk", "occasions": [], "price_paise": None, "stock_status": "few_left", "sell_unit": "piece"},
        {"name": "Banarasi Georgette", "fabric": "banarasi", "occasions": ["party"], "price_paise": 600000, "stock_status": "made_to_order", "sell_unit": "piece"},
    ],
    "materials": [
        {"name": "OPC 53 Cement", "price_paise": 38000, "stock_status": "in_stock", "item_kind": "material", "sell_unit": "bag"},
        {"name": "TMT Steel 12mm", "price_paise": None, "stock_status": "in_stock", "item_kind": "material", "sell_unit": "kg"},
        {"name": "Paver Blocks Zigzag", "price_paise": 4200, "stock_status": "few_left", "item_kind": "material", "sell_unit": "piece"},
        {"name": "Red Clay Bricks", "price_paise": 900, "stock_status": "made_to_order", "item_kind": "material", "sell_unit": "piece"},
    ],
}
BUSINESS = {"textile": "Lakshmi Silks (test)", "materials": "Sri Sai Cements (test)"}


def main(out_dir: Path) -> int:
    packs = ROOT / "packages" / "packs"
    found = sorted(p.parent.name for p in packs.glob("*/lead_finder.json"))
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[str] = []
    all_ok = True
    for pack in found:
        data = packdata.for_pack(pack, packs)
        if data is None:
            continue
        domain = "materials" if data.category_hint in ("contractor", "builder") else "textile"
        stock = stock_lines(STOCK[domain])
        for lang in ("en", "te"):
            for persona in qualify.PERSONAS:
                r = qualify.simulate(business=BUSINESS[domain], data=data, stock=stock, language=lang, persona=persona, domain=domain, likely=data.buyer_types[0].likely)  # type: ignore[arg-type]
                evals = qualify.evaluate(r, stock)
                expected = qualify.EXPECTED_OUTCOME[persona]
                ok = all(e.passed for e in evals) and r.outcome == expected
                all_ok = all_ok and ok
                name = f"{pack}-{lang}-{persona}.md"
                lines = [f"# {pack} · {lang} · {persona}", "", "SIMULATED call (nothing dialled): our scripted assistant against a scripted retailer persona. Invented business and catalogue.", "",
                         f"- Outcome: **{r.outcome}** (expected {expected}); end: {r.end_reason}; WhatsApp agreed: {r.whatsapp_ok}; call back: {r.callback}",
                         f"- Pitched (in stock only): {', '.join(r.pitched) or 'nothing'}", "", "## Transcript", ""]
                lines += [f"- `{t.t:5.1f}s` **{'Assistant' if t.who == 'assistant' else 'Business'}**: {t.text}" for t in r.turns]
                lines += ["", "## Captured", ""] + [f"- {k}: {v}" for k, v in r.captured.items()] + ["", "## Summary", "", r.summary.replace("\n", "  \n"), "", "## Evals", ""]
                lines += [f"- {'PASS' if e.passed else 'FAIL'} {e.name}{(' (' + e.detail + ')') if e.detail else ''}" for e in evals]
                if r.quote_suggestion:
                    lines += ["", "## Quote suggestion (a DRAFT for the Owner's OK; prices only from the catalogue)", ""]
                    lines += [f"- {q['item']}: {('Rs ' + format(q['price_paise'] // 100, ',') + ' per ' + q['unit']) if q['price_paise'] else 'price from the owner'}; they said: {q['quantity_said'] or '-'}" for q in r.quote_suggestion]
                (out_dir / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
                rows.append(f"| {pack} | {lang} | {persona} | {r.outcome} | {expected} | {sum(e.passed for e in evals)}/{len(evals)} | {'PASS' if ok else 'FAIL'} | [{name}]({name}) |")
    index = ["# Simulated qualifying calls (Lead Finder part C)", "", f"{len(rows)} calls: 6 personas x {len(found)} business types x te/en. Scripted on both sides: no model, no telephony, no cost.", "",
             "| pack | lang | persona | outcome | expected | evals | result | transcript |", "|---|---|---|---|---|---|---|---|", *rows, "", f"All passed: {all_ok}"]
    (out_dir / "index.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    print(f"{len(rows)} calls written to {out_dir}; all passed: {all_ok}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path.home() / "Desktop" / "stack19-jobs" / "lead-finder-check" / "calls"))
