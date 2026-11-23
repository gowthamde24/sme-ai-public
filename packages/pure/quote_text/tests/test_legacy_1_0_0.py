"""Renderer 1.0.0 stays re-verifiable: its source, its vectors and its whole original test suite are unchanged.

v1_0_0.py is the 1.0.0 __init__.py byte for byte (its sha256 is pinned below, from before 1.1.0 existed).
The original suites (test_quote_text, test_text_bounds) are re-run against it, hash pin included.
"""
import hashlib
from pathlib import Path
import unittest

import quote_text.v1_0_0 as legacy
import test_quote_text as base
import test_text_bounds as bounds
from golden_support import load

SOURCE_SHA256 = "a6717e5237a92d487768e1b684395dfbe435c6df7c5a38f15986466dd7619387"


class FrozenSourceTests(unittest.TestCase):
    def test_the_1_0_0_source_is_byte_identical_to_what_was_pinned(self):
        source = (Path(legacy.__file__)).read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), SOURCE_SHA256)
        self.assertEqual(legacy.RENDERER_VERSION, "1.0.0")

    def test_1_0_0_vectors_render_to_the_same_text_and_hash(self):
        golden = load("golden_1_0_0.json")
        self.assertEqual(golden["renderer_version"], "1.0.0")
        self.assertEqual(golden["vectors"][0]["expect"]["canonical_hash"], base.GOLDEN_HASH["1.0.0"])
        from golden_support import build
        requests = {"fixture_request": base.request(),
                    "multi_line_long_names": build(["Synthetic weave", "Second synthetic weave with a long name that wraps onto two lines"],
                                                   {"notes": ["Plain note"]})}
        for vector in golden["vectors"]:
            with self.subTest(vector=vector["id"]):
                r = requests[vector["id"]]
                self.assertEqual(hashlib.sha256(legacy.canonical_json(r).encode()).hexdigest(), vector["request_sha256"])
                q = legacy.render(r)
                self.assertEqual(q["text"].split("\n"), vector["expect"]["text"])
                self.assertEqual((q["line_count"], q["canonical_hash"]),
                                 (vector["expect"]["line_count"], vector["expect"]["canonical_hash"]))


class _AgainstLegacy:
    """Runs an original suite with its `engine` module replaced by the frozen 1.0.0 renderer (no unittest.mock: it imports asyncio, which the offline runner breaks)."""

    def setUp(self):
        for module in (base, bounds):
            saved = module.engine
            module.engine = legacy
            self.addCleanup(setattr, module, "engine", saved)
        super().setUp()


class LegacyFormatTests(_AgainstLegacy, base.FormatTests):
    pass


class LegacyRenderTests(_AgainstLegacy, base.RenderTests):
    def test_version_under_test(self):
        self.assertEqual(base.engine.RENDERER_VERSION, "1.0.0")


class LegacyTextBoundsTests(_AgainstLegacy, bounds.TextBoundsTests):
    pass


if __name__ == "__main__":
    unittest.main()
