"""Job DE: the four Auth e-mail templates (Confirm, Invite, Reset password, Magic link) are files in the repository, say Stack19, carry no personal data and link to the app's confirm page with a link type that page accepts.
The dynamic proof (a real mail from a real Auth server, its token verified) is tests/integration/test_auth_templates.py; the Invite mail needs an admin key, so this static test is its cover."""

# ruff: noqa: E501

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path
from typing import cast

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

# template -> the link type its link must carry. A magic link is verified as type=email (GoTrue accepts its token under that type; the confirm page does not take "magiclink").
LINK_TYPE = {"confirmation": "email", "invite": "invite", "recovery": "recovery", "magic_link": "email"}


def config() -> dict[str, dict[str, str]]:
    return cast(dict[str, dict[str, str]], tomllib.loads((ROOT / "supabase" / "config.toml").read_text(encoding="utf-8"))["auth"]["email"]["template"])


def test_every_template_is_a_file_with_a_stack19_subject_in_the_config() -> None:
    cfg = config()
    for name in LINK_TYPE:
        assert name in cfg, f"[auth.email.template.{name}] is missing from supabase/config.toml"
        assert cfg[name]["content_path"] == f"./supabase/templates/{name}.html"
        assert (ROOT / "supabase" / "templates" / f"{name}.html").is_file()
        assert "Stack19" in cfg[name]["subject"]


def test_each_link_goes_to_the_apps_confirm_page_with_the_token_hash_and_its_type() -> None:
    for name, link_type in LINK_TYPE.items():
        html = (ROOT / "supabase" / "templates" / f"{name}.html").read_text(encoding="utf-8")
        links = re.findall(r'href="([^"]+)"', html)
        assert len(links) == 1, f"{name}: exactly one link"
        assert re.fullmatch(r"\{\{ \.SiteURL \}\}/auth/confirm\?token_hash=\{\{ \.TokenHash \}\}&type=" + link_type + r"(&next=/app)?", links[0]), (name, links[0])
        assert "ConfirmationURL" not in html, "not Supabase's own verify address: the app's page verifies on a button press, so a mail scanner cannot use the token up"
        assert "Stack19" in html


def test_a_template_carries_no_personal_data() -> None:
    for name in LINK_TYPE:
        html = (ROOT / "supabase" / "templates" / f"{name}.html").read_text(encoding="utf-8")
        used = set(re.findall(r"\{\{\s*\.(\w+)\s*\}\}", html))
        assert used == {"SiteURL", "TokenHash"}, f"{name} uses {sorted(used)}: only the address and the token belong in a mail (no e-mail address, no data from sign-up)"


def test_the_link_types_are_ones_the_confirm_page_accepts() -> None:
    otp = (ROOT / "apps" / "web" / "lib" / "auth" / "otp.ts").read_text(encoding="utf-8")
    accepted = set(re.findall(r'"(\w+)"', re.search(r"CONFIRM_TYPES = \[(.*?)\]", otp, re.S).group(1)))  # type: ignore[union-attr]
    assert set(LINK_TYPE.values()) <= accepted, (set(LINK_TYPE.values()), accepted)


def test_the_hosted_apply_script_reads_exactly_these_eight_settings() -> None:
    import apply_auth_templates

    wanted = apply_auth_templates.wanted()
    assert sorted(wanted) == sorted(
        [f"mailer_subjects_{n}" for n in LINK_TYPE] + [f"mailer_templates_{n}_content" for n in LINK_TYPE]
    )
    assert all(v.strip() for v in wanted.values())
