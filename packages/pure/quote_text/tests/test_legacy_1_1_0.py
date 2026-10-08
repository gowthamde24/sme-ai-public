"""Renderer 1.1.0 stays re-verifiable: its source and its whole original test suite are unchanged.

v1_1_0.py is the 1.1.0 __init__.py byte for byte (its sha256 is pinned below, from before 1.2.0 existed).
The suites that were the 1.1.0 package's own (test_quote_text, test_text_bounds) are re-run against it, GOLDEN_HASH["1.1.0"]
included. The 1.1.0 golden vectors (fixtures/golden_1_1_0.json) are checked by value in test_joiners.
"""
import hashlib
from pathlib import Path
import unittest

import quote_text.v1_1_0 as frozen
import test_quote_text as base
import test_text_bounds as bounds

SOURCE_SHA256 = "acbfe1477a460254ef81c67706d5274e1fc30b9b28d7e4af9d80b06f71da43d8"


class FrozenSourceTests(unittest.TestCase):
    def test_the_1_1_0_source_is_byte_identical_to_what_was_pinned(self):
        source = Path(frozen.__file__).read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), SOURCE_SHA256)
        self.assertEqual(frozen.RENDERER_VERSION, "1.1.0")


class _AgainstFrozen:
    """Runs an original suite with its `engine` module replaced by the frozen 1.1.0 renderer (no unittest.mock: it imports asyncio, which the offline runner breaks)."""

    def setUp(self):
        for module in (base, bounds):
            saved = module.engine
            module.engine = frozen
            self.addCleanup(setattr, module, "engine", saved)
        super().setUp()


class FrozenFormatTests(_AgainstFrozen, base.FormatTests):
    pass


class FrozenRenderTests(_AgainstFrozen, base.RenderTests):
    def test_version_under_test(self):
        self.assertEqual(base.engine.RENDERER_VERSION, "1.1.0")


class FrozenTextBoundsTests(_AgainstFrozen, bounds.TextBoundsTests):
    pass


if __name__ == "__main__":
    unittest.main()
