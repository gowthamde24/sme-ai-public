"""1.1.0: U+200C / U+200D are allowed after an Indic letter or mark, and nothing else changes.

The rule is the application's (services/ai-api/app/requirements/capture_text.py: a joiner is kept only
after a letter or mark of an Indic script, U+0900..U+0DFF). The package may not import the application,
so the rule's cases are COPIED below (from tests/test_requirements_capture_text.py) and the rule itself is
re-written independently in `reference_unsafe`. If the application's rule ever changes, these cases and
`INDIC_RANGE` here must change with a new renderer version.
"""
import hashlib
import json
import random
import unicodedata
import unittest

import quote_text as engine
import quote_text.v1_0_0 as legacy
import quote_text.v1_1_0 as frozen
from golden_support import LOCATIONS, build, load, place

ZWNJ, ZWJ = "\u200c", "\u200d"
# --- cases copied from the application's tests (test_requirements_capture_text.py) -------------------------
TELUGU = "\u0c15\u0c4d" + ZWNJ + "\u0c37"  # ka + virama + ZWNJ + ssa
KANNADA = "\u0c95\u0ccd" + ZWJ + "\u0cb7"
DEVANAGARI = "\u0915\u094d" + ZWJ + "\u0937"
DEVANAGARI_ZWNJ = "\u0915\u094d" + ZWNJ + "\u0937"
MALAYALAM_CHILLU = "\u0d15\u0d4a\u0d1a\u0d4d\u0d1a\u0d3f\u0d28\u0d4d" + ZWJ  # a chillu typed with ZWJ at the END of a word
KANNADA_END = "\u0cae\u0cc8\u0cb8\u0cc2\u0cb0\u0cc1" + ZWNJ  # a ZWNJ after a word, before a space
APP_KEPT = (TELUGU, KANNADA, DEVANAGARI, DEVANAGARI_ZWNJ, MALAYALAM_CHILLU, KANNADA_END)
# the application removes these, so the renderer refuses them: not between Latin letters, not inside a
# number, not at the start, not after a space, not after an Indic DIGIT, and a second joiner follows a joiner
APP_REMOVED = ("a" + ZWJ + "b", "98765" + ZWNJ + "43210", ZWJ + "\u0915", " " + ZWNJ + "x",
               "\u0915" + ZWJ + ZWJ, "\u0915" + ZWJ + ZWNJ, "\u0967" + ZWJ + "\u0968")
# every other format / control / separator character, "still removed even right after an Indic letter"
APP_FORMAT = ("\u200b", "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2060", "\u2061",
              "\u2066", "\u2067", "\u2068", "\u2069", "\ufeff", "\u00ad", "\U000e0041", "\U000e007f", "\u061c")
# from the application's text_rules tests: controls, separators and a lone surrogate
APP_OTHER = ("\x00", "\x07", "\t", "\r", "\x1b", "\x7f", "\x85", "\n", "\u2028", "\u2029", "\ud800", "\udfff")
INDIC_RANGE = (0x0900, 0x0DFF)
# ---------------------------------------------------------------------------------------------------------

REFUSED_BY_BOTH_VERSIONS = ("Cc", "Cf", "Cs", "Zl", "Zp")


def category(char):
    return unicodedata.category(char)


def reference_unsafe(value):
    """The rule written out a second time, from the sentence above; not the module's code."""
    for i, char in enumerate(value):
        if char in (ZWNJ, ZWJ):
            if i == 0:
                return True
            before = value[i - 1]
            if not (INDIC_RANGE[0] <= ord(before) <= INDIC_RANGE[1] and category(before)[0] in ("L", "M")):
                return True
        elif category(char) in REFUSED_BY_BOTH_VERSIONS:
            return True
    return False


def refuses(module, value):
    try:
        module._string(value, allow_empty=True)
    except module._Invalid as exc:
        assert str(exc) == "UNSAFE_STRING", (str(exc), value)
        return True
    return False


def independent_hash(inputs, version):
    payload = json.dumps({"renderer_version": version, "inputs": inputs}, sort_keys=True,
                         separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class VersionTests(unittest.TestCase):
    def test_version_and_registry(self):
        self.assertEqual(engine.RENDERER_VERSION, "1.2.0")
        self.assertEqual(engine.SUPPORTED_VERSIONS, ("1.0.0", "1.1.0", "1.2.0"))
        self.assertIs(engine.renderer_for("1.2.0"), engine)
        self.assertIs(engine.renderer_for("1.1.0"), frozen)
        self.assertIs(engine.renderer_for("1.0.0"), legacy)
        self.assertEqual(legacy.RENDERER_VERSION, "1.0.0")
        self.assertEqual(frozen.RENDERER_VERSION, "1.1.0")
        for bad in ("1.0.1", "1.3.0", "2.0.0", "", "1.0", None, 1):
            with self.assertRaises(KeyError):
                engine.renderer_for(bad)

    def test_the_version_is_part_of_the_hash_and_only_the_hash_differs(self):
        r = build(["Synthetic weave", "Second synthetic weave"])
        # build() ships a non-zero fee, so 1.2.0 hides nothing here and the three versions print the same text
        new, old = engine.render(r), legacy.render(r)
        self.assertEqual((new["text"], new["line_count"]), (old["text"], old["line_count"]))
        self.assertNotEqual(new["canonical_hash"], old["canonical_hash"])
        self.assertEqual(new["canonical_hash"], independent_hash(r, "1.2.0"))
        self.assertEqual(frozen.render(r)["canonical_hash"], independent_hash(r, "1.1.0"))
        self.assertEqual(old["canonical_hash"], independent_hash(r, "1.0.0"))


class RuleCaseTests(unittest.TestCase):
    """The application's cases, copied."""

    def test_names_the_application_keeps_are_accepted_alone_and_in_context(self):
        for raw in APP_KEPT:
            for value in (raw, f"{raw} {raw}", f"Pattu {raw}.", f"{raw}\n"[:-1]):
                with self.subTest(value=value):
                    self.assertFalse(refuses(engine, value))
                    self.assertTrue(refuses(legacy, value))  # the old renderer refused every one of them

    def test_joiners_the_application_removes_are_refused(self):
        for value in APP_REMOVED:
            with self.subTest(value=value):
                self.assertTrue(refuses(engine, value))
                self.assertTrue(refuses(legacy, value))

    def test_a_single_joiner_after_a_letter_is_accepted_a_second_is_not(self):
        self.assertFalse(refuses(engine, "\u0915" + ZWJ))
        self.assertFalse(refuses(engine, "\u0915" + ZWNJ))
        self.assertTrue(refuses(engine, "\u0915" + ZWJ + ZWJ))
        self.assertFalse(refuses(engine, "\u0915" + ZWJ + "\u0937" + ZWNJ))  # letter, joiner, letter, joiner

    def test_every_other_format_control_and_separator_stays_refused_even_after_an_indic_letter(self):
        for char in APP_FORMAT + APP_OTHER:
            for value in (char, "Silk" + char + "House", "\u0c15" + char + "\u0c37", "\u0c15" + char,
                          "\u0c15" + ZWJ + char, "\u0c15" + char + ZWJ, "\u0c15" + char + ZWJ + "\u0c37"):
                with self.subTest(char=hex(ord(char)), value=value):
                    self.assertTrue(refuses(engine, value))
                    self.assertTrue(refuses(legacy, value))

    def test_boundaries_of_the_indic_range_and_categories(self):
        accepts = {0x0900: True,   # Mn, first of the range
                   0x0915: True, 0x094D: True, 0x0C15: True, 0x0C4D: True, 0x0D3A: True, 0x0DF3: True,
                   0x0DF4: False,  # Sinhala kunddaliya, Po: not a letter or mark
                   0x0DF5: False, 0x0DFF: False,  # unassigned
                   0x08FF: False,  # Arabic extended mark, below the range
                   0x0E01: False,  # Thai letter, above the range
                   0x0964: False, 0x0965: False,  # danda, Po
                   0x0966: False, 0x0C66: False,  # Indic digits, Nd
                   0x0BF0: False,  # Tamil number ten, No
                   0x0628: False, 0x0041: False, 0x0030: False, 0x0020: False}
        for code, expected in accepts.items():
            with self.subTest(code=hex(code)):
                self.assertIsNot(refuses(engine, chr(code) + ZWJ), expected)
                self.assertIsNot(refuses(engine, chr(code) + ZWNJ), expected)


class ExhaustiveTests(unittest.TestCase):
    """The new version accepts exactly the old set plus the two joiners in the allowed positions."""

    def test_every_code_point_alone_and_in_a_word_keeps_its_old_verdict_except_the_joiners(self):
        for code in range(0x110000):
            char = chr(code)
            for value in (char, "a" + char + "b"):
                new, old = refuses(engine, value), refuses(legacy, value)
                if char in (ZWNJ, ZWJ):
                    self.assertTrue(new and old, hex(code))  # not alone, not between Latin letters
                elif new != old:
                    self.fail("verdict changed for " + hex(code))

    def test_every_code_point_before_a_joiner_exactly_the_indic_letters_and_marks_pass(self):
        allowed = []
        for code in range(0x110000):
            char = chr(code)
            for joiner in (ZWNJ, ZWJ):
                accepted = not refuses(engine, char + joiner)
                self.assertEqual(accepted, not reference_unsafe(char + joiner), hex(code))
                if accepted and joiner == ZWJ:
                    allowed.append(code)
                if accepted:
                    self.assertTrue(INDIC_RANGE[0] <= code <= INDIC_RANGE[1] and category(char)[0] in "LM", hex(code))
        # pinned: today's Unicode data. If Python's tables move, this fails loudly rather than silently.
        self.assertTrue(0x0915 in allowed and 0x0C4D in allowed and 0x0900 in allowed)
        self.assertEqual((min(allowed), max(allowed)), (0x0900, 0x0DF3))
        self.assertTrue(all(category(chr(c))[0] in "LM" for c in allowed))
        self.assertEqual(allowed, [c for c in range(INDIC_RANGE[0], INDIC_RANGE[1] + 1) if category(chr(c))[0] in "LM"])

    def test_every_code_point_after_a_joiner_after_a_letter_keeps_its_verdict(self):
        for code in range(0x110000):
            char = chr(code)
            for value in ("\u0c15" + ZWJ + char, "\u0c15" + ZWNJ + char + "\u0c37"):
                expected = char in (ZWNJ, ZWJ) or category(char) in REFUSED_BY_BOTH_VERSIONS
                self.assertIs(refuses(engine, value), expected, hex(code))

    def test_seeded_random_strings_against_the_old_renderer_as_oracle(self):
        """New accepts a string exactly when the OLD renderer accepts it without its joiners and every joiner follows an Indic letter or mark."""
        rng = random.Random(1100)
        pool = ["a", "Z", "5", " ", "-", "\u0c15", "\u0c4d", "\u0c37", "\u0915", "\u094d", "\u0d4d", "\u0d28", "\u0967",
                "\u0964", ZWNJ, ZWJ, ZWNJ, ZWJ, "\u200b", "\u2060", "\ufeff", "\u200e", "\u202e", "\n", "\x00",
                "\u2028", "\U000e0041", "\ud800", "\ue000", "\u0378", "\u0628", "\u00ad"]
        seen = {True: 0, False: 0}
        for _ in range(60000):
            value = "".join(rng.choice(pool) for _ in range(rng.randint(1, 8)))
            without = value.replace(ZWNJ, "").replace(ZWJ, "")
            placed = all(i > 0 and value[i - 1] not in (ZWNJ, ZWJ) and not reference_unsafe(value[i - 1] + value[i])
                         for i, char in enumerate(value) if char in (ZWNJ, ZWJ))
            expected_refused = not (not refuses(legacy, without) and placed)
            self.assertIs(refuses(engine, value), expected_refused, ascii(value))
            self.assertIs(refuses(engine, value), reference_unsafe(value), ascii(value))
            seen[expected_refused] += 1
        self.assertGreater(min(seen.values()), 1000)

    def test_private_use_and_unassigned_are_unchanged_from_1_0_0(self):
        # KNOWN GAP, kept on purpose: 1.0.0 never refused Co or Cn characters (the database text rule does not
        # either), so 1.1.0 does not change that. Tightening is its own version (see VERSIONS.md).
        for char in ("\ue000", "\U000f0000", "\u0378", "\U0010ffff"):
            self.assertFalse(refuses(engine, "Silk" + char))
            self.assertFalse(refuses(legacy, "Silk" + char))


class RenderTests(unittest.TestCase):
    def test_golden_vectors_render_to_the_pinned_text_and_hash(self):
        golden = load("golden_1_1_0.json")
        self.assertEqual(golden["renderer_version"], frozen.RENDERER_VERSION)
        ids = {v["id"] for v in golden["accepted"]}
        self.assertTrue({"telugu_zwnj", "kannada_zwj", "devanagari_zwj", "devanagari_zwnj",
                         "malayalam_chillu_at_end_of_word", "joiner_in_longer_quote"} <= ids)
        for v in golden["accepted"]:
            with self.subTest(vector=v["id"]):
                r = build(v["names"], v.get("display"))
                # the vectors pin 1.1.0 by value (text and hash); 1.2.0 prints the same text (non-zero fee) under its own hash
                old = frozen.render(r)
                self.assertEqual((old["line_count"], old["canonical_hash"]),
                                 (v["expect"]["line_count"], v["expect"]["canonical_hash"]))
                q = engine.render(r)
                self.assertEqual(set(q), {"text", "line_count", "canonical_hash"}, q)
                self.assertEqual(q["text"].split("\n"), v["expect"]["text"])
                self.assertEqual(q["line_count"], v["expect"]["line_count"])
                self.assertEqual(q["canonical_hash"], independent_hash(r, "1.2.0"))
                self.assertNotEqual(q["canonical_hash"], old["canonical_hash"])
                self.assertTrue(all(len(line) <= 60 for line in q["text"].split("\n")))
                # a short product name reaches the customer text whole
                for name in v["names"]:
                    if len(name) <= 40:
                        self.assertIn(name, q["text"])
                self.assertEqual(q["text"].count(ZWJ) + q["text"].count(ZWNJ),
                                 sum(s.count(ZWJ) + s.count(ZWNJ) for s in v["names"])
                                 + sum(s.count(ZWJ) + s.count(ZWNJ) for s in _display_strings(v)))

    def test_old_renderer_refuses_every_accepted_vector_with_a_joiner(self):
        for v in load("golden_1_1_0.json")["accepted"]:
            if any(j in "".join(v["names"]) for j in (ZWNJ, ZWJ)):
                with self.subTest(vector=v["id"]):
                    q = legacy.render(build(v["names"], v.get("display")))
                    self.assertEqual((q["status"], q["code"]), ("rejected", "UNSAFE_STRING"))

    def test_a_joiner_name_is_accepted_in_every_location_a_string_can_sit(self):
        for location in LOCATIONS:
            for raw in APP_KEPT:
                value = "Name " + raw
                with self.subTest(location=location, value=value):
                    q = engine.render(place(value, location))
                    self.assertIn("text", q, q)
                    if location != "line_name":  # the engine's name is validated and hashed, the label is what is printed
                        self.assertIn(value, q["text"])

    def test_refused_vectors_in_every_location(self):
        golden = load("golden_1_1_0.json")
        self.assertEqual(golden["refused_code"], "UNSAFE_STRING")
        for v in golden["refused"]:
            for location in LOCATIONS:
                with self.subTest(vector=v["id"], location=location):
                    for module in (engine, legacy):
                        q = module.render(place(v["value"], location))
                        self.assertEqual((q["status"], q["code"]), ("rejected", golden["refused_code"]), q)
                        self.assertNotIn("text", q)

    def test_refused_vectors_are_the_ones_the_reference_rule_refuses(self):
        for v in load("golden_1_1_0.json")["refused"]:
            self.assertTrue(reference_unsafe(v["value"]), v["id"])
        for v in load("golden_1_1_0.json")["accepted"]:
            for name in v["names"]:
                self.assertFalse(reference_unsafe(name), v["id"])

    def test_joiners_do_not_launder_other_failures(self):
        r = place("Pattu " + TELUGU, "line_label")
        r["quote"]["totals"]["total"] += 1
        self.assertEqual(engine.render(r)["code"], "INVALID_QUOTE")
        r = place("Pattu " + TELUGU, "seller_name")
        r["approved"] = False
        self.assertEqual(engine.render(r)["code"], "NOT_APPROVED")
        r = place("Pattu " + TELUGU, "customer_name")
        r["expected_engine_hash"] = "0" * 64
        self.assertEqual(engine.render(r)["code"], "HASH_MISMATCH")

    def test_joiners_count_in_the_string_limit_and_markup_is_still_neutralised(self):
        self.assertIn("text", engine.render(place(("\u0c15" + ZWJ) * 100, "note")))
        self.assertEqual(engine.render(place(("\u0c15" + ZWJ) * 101, "note"))["code"], "OUT_OF_RANGE")
        q = engine.render(place("*" + TELUGU + "* _" + KANNADA + "_", "line_label"))
        self.assertIn(TELUGU + " " + KANNADA, q["text"])
        for char in "*_":
            self.assertNotIn(char, q["text"])

    def test_a_joiner_only_name_is_refused_and_a_blank_one_is_still_blank(self):
        self.assertEqual(engine.render(place(ZWJ, "line_label"))["code"], "UNSAFE_STRING")
        self.assertEqual(engine.render(place("*", "seller_name"))["code"], "EMPTY_STRING")

    def test_a_long_unbroken_word_with_joiners_still_wraps_within_the_width(self):
        word = "".join(c + ZWJ for c in "\u0c15\u0c16\u0c17\u0c18") * 20  # 160 characters, no space
        q = engine.render(place(word, "line_label"))
        lines = q["text"].split("\n")
        self.assertTrue(all(len(line) <= 60 for line in lines))
        self.assertEqual(q["text"].count(ZWJ), word.count(ZWJ))  # none lost or added by wrapping


def _display_strings(vector):
    display = vector.get("display") or {}
    out = []
    for value in display.values():
        out.extend(value if isinstance(value, list) else [value])
    return out


if __name__ == "__main__":
    unittest.main()
