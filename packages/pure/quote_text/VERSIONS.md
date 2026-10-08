# quote_text renderer versions

The renderer's version is `RENDERER_VERSION` in `__init__.py`. It is part of the hashed payload
(`canonical_hash = sha256(canonical_json({"renderer_version": V, "inputs": request}))`), so the same request has a
different hash under a different version. Semantic versioning: any change of what is accepted or printed is at least
a minor version; the text for a request both versions accept must stay identical unless the change says otherwise.

| Version | Module | Status | What it is |
| --- | --- | --- | --- |
| 1.2.0 | `quote_text` (`__init__.py`) | current | a shipping line whose amount is zero is not printed |
| 1.1.0 | `quote_text.v1_1_0` | frozen | U+200C / U+200D allowed after an Indic letter or mark |
| 1.0.0 | `quote_text.v1_0_0` | frozen | the first renderer; refuses U+200C and U+200D everywhere |

## Frozen versions

`v1_0_0.py` is the 1.0.0 `__init__.py` byte for byte (sha256 `a6717e52...9387`, pinned in
`tests/test_legacy_1_0_0.py`); `v1_1_0.py` is the 1.1.0 `__init__.py` byte for byte (sha256 `acbfe147...43d8`, pinned in
`tests/test_legacy_1_1_0.py`). Never edit either. A quote rendered with 1.0.0 or 1.1.0 is re-verified with
`quote_text.renderer_for("1.0.0")` / `renderer_for("1.1.0")`; `renderer_for("1.2.0")` is the package itself; any other
version raises `KeyError`. Each `test_legacy_*` file also re-runs the original suites (`test_quote_text`,
`test_text_bounds`, hash pin included) against its frozen module; `fixtures/golden_1_0_0.json` is checked there and
`fixtures/golden_1_1_0.json` in `tests/test_joiners.py`.

To add a version: copy the current `__init__.py` to `v<major>_<minor>_<patch>.py` unchanged, pin its sha256 the
same way, bump `RENDERER_VERSION` and `SUPPORTED_VERSIONS`, add `GOLDEN_HASH[<version>]`, add vectors.

## 1.1.0: zero-width joiner and non-joiner

Why: Telugu, Kannada, Devanagari and Malayalam spell real words with U+200D (ZWJ) and U+200C (ZWNJ); a product
name with one made the whole customer text `quote_text_refused`.

The rule applies to every string the renderer validates (product name, display labels, seller, customer, notes,
payment terms text, keys), because the application's text rule is not per field. It is the application's rule
(`services/ai-api/app/requirements/capture_text.py`), re-implemented here because the package imports nothing:

- a joiner is allowed only DIRECTLY after a letter (`L*`) or mark (`M*`) in U+0900..U+0DFF (Devanagari to Sinhala);
- so it is refused at the start, after a space, between Latin letters, inside or next to digits, after an Indic
  digit, danda or other punctuation, and twice in a row (the second follows a joiner, not a letter or mark);
- every other control, format, bidirectional, tag, surrogate, line and paragraph separator is refused exactly as in
  1.0.0, even right after an Indic letter: U+200B, U+2060, U+FEFF, U+00AD, U+200E/F, U+061C, U+202A-E,
  U+2066-9, U+E0000-E007F, newline, tab, NUL.

Property: for every string, 1.1.0 accepts it exactly when 1.0.0 accepts it without its joiners and every joiner
follows an Indic letter or mark. `tests/test_joiners.py` checks this over every code point, over every
(code point, joiner) pair and over 60,000 seeded random strings, plus the application's copied cases.

Vectors: `tests/fixtures/golden_1_1_0.json` (accepted: Telugu, Kannada, Devanagari ZWJ and ZWNJ, Malayalam chillu at
the end of a word, a longer quote with joiners in names, customer, notes and payment terms, a wrapped long name;
refused: 33 strings). Written once from the reviewed output, with escapes, so a reviewer can read the code points.
Never regenerate a vector to make a failing test pass; a changed vector means a changed version.

### Known limits (unchanged from 1.0.0, not fixed here)

- Private-use (Co) and unassigned (Cn) characters are NOT refused by 1.0.0 or 1.1.0 (only Cc, Cf, Cs, Zl, Zp are).
  The application's CSV rule refuses them and the database text rule does not. Pinned by
  `test_private_use_and_unassigned_are_unchanged_from_1_0_0`; tightening is its own version.
- Wrapping (`textwrap`, width 60 counted in code points) can cut a very long unbroken word anywhere, including
  between a letter and its joiner or combining mark. No joiner is lost or added; the cut may start a line with one.
  Names with spaces wrap at spaces. Joiners count toward the 60 and the 200 character limits.

## 1.2.0: no zero shipping lines

Why: the owners decided (docs/plans/manual-price-quote-plan.md, section 12, item 4, 2026-10-08) that a quote shows no
shipping line whose amount is zero. A business with no courier has a policy fee of 0, and 1.1.0 still printed
`Shipping net`, `GST on shipping (r%)` and `Shipping total` with 0.00 on every quote.

The rule: each of the three lines is printed only when its own amount (`totals.shipping`, `totals.shipping_tax`,
`totals.shipping_gross`) is not zero. Consequences, all pinned in `tests/test_hide_zero_shipping.py`:

- fee 0: all three are left out (the text goes from `GST on merchandise` straight to `GST total`);
- a fee with a 0% rate: `Shipping net` and `Shipping total` are printed, `GST on shipping (0%)` is not;
- all three non-zero: the text is the 1.1.0 text exactly (and the 1.0.0 text, for a request 1.0.0 accepts);
- exactly one of the three being non-zero cannot happen: the validator requires `shipping_gross = shipping + shipping_tax`.

Nothing else changes: validation (including the single `shipping.tax.*` trace, still required when the fee is 0), the
order and wording of every other line, totals, wrapping, limits and refusals. Property, checked over 300 seeded
quotes and every case above: the 1.2.0 text equals the 1.1.0 text with exactly the shipping lines that print `₹0.00`
removed, and `line_count` drops by that number. The version is part of the hash, so every request hashes differently
under 1.2.0 even when the text is identical.

Adopting it is a lane A change (the API's `ALLOWED_RENDERER_VERSIONS` and its tests); a quote already created stays pinned to the
renderer version it was made with, and `renderer_for("1.1.0")` re-renders it.
