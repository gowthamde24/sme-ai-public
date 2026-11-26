# ruff: noqa: E501
"""The business's own type label (Other): markup is stripped before the length rule, in the sign-up body and in the profile patch."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.plain_label import plain
from app.workspace.business import BusinessPatch


def test_tags_and_angle_brackets_are_removed_and_spaces_collapsed() -> None:
    assert plain("<b>Tent  house</b> <script>x</script>") == "Tent house x"
    assert plain("a < b > c") == "a c"   # the span between the brackets is read as a tag
    assert plain("5 > 3") == "5 3"
    assert BusinessPatch(type_label="  <i>Photo studio</i> ").type_label == "Photo studio"


@pytest.mark.parametrize("bad", ["<>", "<b></b>", " ", "x", "y" * 61])
def test_a_label_that_is_empty_after_stripping_or_too_long_is_refused(bad: str) -> None:
    with pytest.raises(ValidationError):
        BusinessPatch(type_label=bad)
