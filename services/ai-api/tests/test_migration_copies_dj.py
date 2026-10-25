"""Job DJ (ADR 0093): migration 20261128090000 REPLACES, as a FULL COPY, `public.scheduler_voice_plan` (job CV) so that its answer also names the chosen voice's provider and speaker. It must be the LAST definition and
differ from the CV copy by EXACTLY the lines named here, so a copy of an old definition can never silently undo the rules of the plan (the module, the switches, the disclosure, the allowance, the length)."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

DJ = "20261128090000_dj_voice_speakers.sql"
DROPPED = {"return jsonb_build_object('voice', true, 'voice_code', v_voice, 'speed', s.speed, 'language', m.language, 'text', v_text, 'chars', char_length(v_text));"}
ADDED = {
    "vv      voice.voices;",
    "select * into vv from voice.voices x where x.code = v_voice and x.language = m.language;",
    "return jsonb_build_object('voice', true, 'voice_code', v_voice, 'provider', vv.provider, 'speaker', vv.speaker, 'speed', s.speed, 'language', m.language, 'text', v_text, 'chars', char_length(v_text));",
}


def test_the_dj_copy_of_the_voice_plan_is_the_last_definition_and_only_adds_the_provider_and_speaker() -> None:
    defs = definitions("public.scheduler_voice_plan")
    assert defs[-1][0] == DJ, f"redefined after job DJ's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == "20261126090000_cv_voice_notes.sql"
    diff = [line for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0) if line[:1] in "+-" and not line.startswith(("---", "+++"))]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == {w.strip() for w in DROPPED}
    assert {line[1:].strip() for line in diff if line[0] == "+"} == {w.strip() for w in ADDED}
