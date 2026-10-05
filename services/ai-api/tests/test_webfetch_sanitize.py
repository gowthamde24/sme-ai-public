"""The sanitiser: visible text only, nothing hidden, contact details removed, characters cleaned."""

from __future__ import annotations

import random

import pytest

from app.webfetch.sanitize import (
    CONTACT_MARKER,
    clean_characters,
    sanitize_html,
    sanitize_plain,
    scrub_contacts,
)

LIMIT = 8000


def text_of(html: str) -> str:
    return sanitize_html(html, max_chars=LIMIT).text


def test_visible_text_survives_with_block_structure() -> None:
    html = "<html><head><title>Acme Silks</title></head><body><h1>Sarees</h1><p>Wholesale silk sarees.</p><ul><li>Kanjivaram</li><li>Banarasi</li></ul></body></html>"  # noqa: E501
    assert text_of(html) == "Acme Silks\nSarees\nWholesale silk sarees.\nKanjivaram\nBanarasi"


@pytest.mark.parametrize(
    ("html", "gone"),
    [
        ("<p>ok</p><script>steal()</script>", "steal"),
        ("<p>ok</p><SCRIPT type='x'>steal()</SCRIPT>", "steal"),
        ("<p>ok</p><style>.a{content:'steal'}</style>", "steal"),
        ("<p>ok</p><!-- steal -->", "steal"),
        ("<p>ok</p><noscript>steal</noscript>", "steal"),
        ("<p>ok</p><template><p>steal</p></template>", "steal"),
        ("<p>ok</p><svg><text>steal</text></svg>", "steal"),
        ("<p>ok</p><iframe>steal</iframe>", "steal"),
        ("<p>ok</p><object>steal</object>", "steal"),
        ("<p>ok</p><select><option>steal</option></select>", "steal"),
        ("<p>ok</p><textarea>steal</textarea>", "steal"),
        ("<p>ok</p><canvas>steal</canvas><video>steal</video><audio>steal</audio>", "steal"),
        ("<p>ok</p><math><mi>steal</mi></math>", "steal"),
        ("<p>ok</p><datalist><option>steal</option></datalist>", "steal"),
        ("<p>ok</p><meta name='description' content='steal'>", "steal"),
        ("<p>ok</p><img alt='steal' src='x'>", "steal"),
        ("<p title='steal' data-x='steal' aria-label='steal'>ok</p>", "steal"),
        ("<a href='steal'>ok</a>", "steal"),
        ("<p>ok</p><input value='steal' type='hidden'>", "steal"),
        ("<p>ok</p><link rel='x' href='steal'>", "steal"),
        ("<p>ok</p><script>unclosed steal", "steal"),
        ("<p>ok</p><style>unclosed steal", "steal"),
        ("<p>ok</p><!-- unclosed steal", "steal"),
    ],
)
def test_scripts_styles_comments_templates_and_attributes_are_dropped(html: str, gone: str) -> None:
    out = text_of(html)
    assert gone not in out
    assert "ok" in out or html.startswith("<a")


@pytest.mark.parametrize(
    "attrs",
    [
        "hidden",
        "hidden=''",
        "hidden='until-found'",
        "aria-hidden='true'",
        "aria-hidden=' TRUE '",
        "style='display:none'",
        "style='display : none'",
        "style='DISPLAY:NONE !important'",
        "style='color:red;display:none;margin:0'",
        "style='visibility:hidden'",
        "style='visibility: collapse'",
        "style='font-size:0'",
        "style='font-size:0px'",
        "style='font-size: 0.0em !important'",
        "style='opacity:0'",
        "style='opacity: 0.0'",
        "style='width:0'",
        "style='height:0px'",
        "style='max-height:0'",
        "style='text-indent:-9999px'",
        "style='text-indent: -5000px'",
        "style='position:absolute;left:-9999px'",
        "style='position:absolute;top:-2000px'",
        "style='margin-left:-1000px'",
        "style='clip:rect(0,0,0,0)'",
        "style='clip-path:inset(50%)'",
        "class='sr-only'",
        "class='visually-hidden'",
        "class='a screen-reader-text b'",
        "class='d-none'",
        "class='invisible'",
        "class='HIDDEN'",
    ],
)
def test_elements_a_reader_would_not_see_are_dropped(attrs: str) -> None:
    out = text_of(f"<p>seen</p><div {attrs}>HIDDENTEXT <b>nested</b></div><p>also seen</p>")
    assert "HIDDENTEXT" not in out and "nested" not in out
    assert "seen" in out and "also seen" in out


@pytest.mark.parametrize(
    "attrs",
    [
        "style='color:red'",
        "style='font-size:12px'",
        "style='opacity:0.5'",
        "style='display:block'",
        "style='width:100px'",
        "style='margin-left:-10px'",
        "style='text-indent:-5px'",
        "class='container'",
        "class='hiddenish'",
        "class='not-sr-only-at-all'",
        "title='hidden'",
        "data-hidden='true'",
        "aria-hidden='false'",
    ],
)
def test_ordinary_elements_are_kept(attrs: str) -> None:
    assert "VISIBLE" in text_of(f"<div {attrs}>VISIBLE</div>")


def test_hidden_inside_hidden_and_visible_lookalikes_inside_hidden() -> None:
    html = (
        "<div style='display:none'><p>one</p><div><span>two</span></div><p style='display:block'>three</p></div>"  # noqa: E501
        "<p>shown</p>"
    )
    assert text_of(html) == "shown"


def test_mis_nested_and_unclosed_markup_does_not_leak_or_crash() -> None:
    assert "LEAK" not in text_of("<div style='display:none'><p>LEAK</div>after")
    assert "LEAK" not in text_of("<div hidden><span>LEAK</div></span>")
    assert text_of("<b><i>text</b></i> more") == "text more"
    assert text_of("</div></div></p>stray ends") == "stray ends"
    assert "LEAK" not in text_of("<div hidden>LEAK")  # never closed: the rest stays hidden
    assert text_of("<p>a<br>b<br/>c</p>") == "a\nb\nc"


def test_entities_are_decoded_and_text_is_normalised() -> None:
    assert (
        text_of("<p>Tom &amp; Jerry &lt;b&gt; &#65; &#x42; &nbsp;x</p>") == "Tom & Jerry <b> A B x"
    )
    assert text_of("<p>ﬁne ＡＢＣ ①</p>") == "fine ABC 1"  # NFKC


@pytest.mark.parametrize(
    "char",
    [
        "\u200b",
        "\u2060",
        "\ufeff",
        "\u202e",
        "\u202d",
        "\u2066",
        "\u2069",
        "\U000e0041",
        "\x07",
        "\x1b",
        "\x7f",
        "\x85",
        "\ue000",
        "\ud800",
    ],
)
def test_invisible_bidi_control_and_tag_characters_are_removed(char: str) -> None:
    assert clean_characters(f"a{char}b") == "ab"
    assert text_of(f"<p>a{char}b</p>") == "ab"


def test_unassigned_code_points_are_removed() -> None:
    assert clean_characters("a" + chr(0x378) + "b") == "ab"  # U+0378 is unassigned (category Cn)
    assert clean_characters("a" + chr(0xFFFF) + "b") == "ab"  # a non-character


def test_a_very_long_local_part_is_scrubbed_whole() -> None:
    assert scrub_contacts("x" * 100 + "@example.com") == CONTACT_MARKER


def test_joiners_and_direction_marks_needed_by_indic_and_rtl_text_are_kept() -> None:
    word = "क्\u200dष"  # a conjunct written with a ZWJ
    assert clean_characters(word) == word
    assert clean_characters("a\u200eb\u200fc") == "a\u200eb\u200fc"
    assert "క్ష" in text_of("<p>క్ష తెలుగు</p>")


@pytest.mark.parametrize(
    ("raw", "kept"),
    [
        ("mail ramesh@acme-silks.in now", "mail " + CONTACT_MARKER + " now"),
        ("A.B+tag@sub.example.co.in", CONTACT_MARKER),
        ("call +91 98765 43210 today", "call " + CONTACT_MARKER + " today"),
        ("call 098765-43210", "call " + CONTACT_MARKER),
        ("(022) 2345 6789", CONTACT_MARKER),
        ("tel:+91-9876543210;", "tel:" + CONTACT_MARKER + ";"),
        ("wa.me/919876543210", "wa.me/" + CONTACT_MARKER),  # a chat link carries the number
        ("name＠host.com", "name＠host.com"),
        ("Est. 1985", "Est. 1985"),
        ("Rs 1200 per piece, min 5 pieces", "Rs 1200 per piece, min 5 pieces"),
        ("5-10 sarees, 2024-2025", "5-10 sarees, 2024-2025"),
        ("pin 600001", "pin 600001"),
        ("a@b", "a@b"),
        ("100,000", "100,000"),
    ],
)
def test_e_mail_addresses_and_phone_numbers_are_replaced_before_anything_else_sees_them(
    raw: str, kept: str
) -> None:
    assert scrub_contacts(clean_characters(raw)) == kept or scrub_contacts(raw) == kept


def test_a_zero_width_trick_inside_an_address_does_not_defeat_the_scrub() -> None:
    assert text_of("<p>mail a\u200b@\u2060example.com</p>") == "mail " + CONTACT_MARKER
    assert text_of("<p>+91\u200b 98765\u2060 43210</p>") == CONTACT_MARKER


def test_text_is_cut_to_the_limit_and_says_so() -> None:
    long = "<p>" + "word " * 5000 + "</p>"
    result = sanitize_html(long, max_chars=100)
    assert len(result.text) <= 100 and result.truncated
    short = sanitize_html("<p>short</p>", max_chars=100)
    assert short.text == "short" and not short.truncated


def test_hidden_elements_are_counted() -> None:
    result = sanitize_html(
        "<p>x</p><script>a</script><style>b</style><!--c--><div hidden>d</div>", max_chars=LIMIT
    )
    assert result.hidden_elements == 4


def test_plain_text_is_cleaned_and_scrubbed_but_not_parsed_as_html() -> None:
    result = sanitize_plain("a <script>x</script> b\u200b\nmail me@x.com", max_chars=LIMIT)
    assert result.text == "a <script>x</script> b\nmail " + CONTACT_MARKER


def test_deeply_nested_and_huge_input_is_handled_in_bounded_time() -> None:
    nested = "<div>" * 20000 + "deep" + "</div>" * 20000
    assert text_of(nested) == "deep"
    assert text_of("<p>" + "x" * 1_000_000).startswith("x")
    assert text_of("<" * 5000 + "a") != ""


def test_malformed_markup_never_raises() -> None:
    rng = random.Random(7)  # noqa: S311
    pieces = [
        "<",
        ">",
        "</",
        "<div",
        "<p>",
        "</p>",
        "<script>",
        "</script>",
        "<!--",
        "-->",
        "&",
        "&#",
        "'",
        '"',
        "=",
        "<a href=",
        "x",
        " ",
        "\n",
        "<style",
        "<br/>",
        "\x00",
        "<![CDATA[",
        "<?xml",
        "<!DOCTYPE",
    ]
    for _ in range(300):
        junk = "".join(rng.choice(pieces) for _ in range(rng.randint(1, 60)))
        sanitize_html(junk, max_chars=LIMIT)


def test_the_output_never_contains_markup_that_was_dropped() -> None:
    out = text_of("<div><script>alert(1)</script><style>a{}</style><p onclick='x()'>t</p></div>")
    assert out == "t"
