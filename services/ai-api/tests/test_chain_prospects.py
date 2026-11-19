"""A search for new businesses never chains on to calling or messaging them (owner, 18 Nov 2026)."""

# ruff: noqa: E501

from __future__ import annotations

from app.assistant_work.chain import without_prospect_steps


def test_the_steps_that_would_call_or_message_what_the_finder_found_are_dropped() -> None:
    rest = ["Save the 10 jewellery shops found in Jayanagar as leads", "Send our catalogue to the jewellery shops"]
    assert without_prospect_steps("Find 10 jewellery shops in Jayanagar", rest) == [rest[0]]
    assert without_prospect_steps("Find new shops in Jayanagar", ["Call them and ask what they need"]) == []


def test_other_chains_are_untouched() -> None:
    rest = ["Call Ravi and ask about a visit"]
    assert without_prospect_steps("Add Ravi Teja as a lead", rest) == rest
    assert without_prospect_steps("Check who has not replied for 3 days", ["Send them a reminder"]) == ["Send them a reminder"]


def test_ordered_steps_in_telugu_hindi_and_kannada_look_chained() -> None:
    """Eval case 50 flip-flopped (19 Nov): its Telugu wording had no ordering word the hint knew, so the model sometimes saw one step. 'then' in te/hi/kn now counts like English 'then'."""
    from app.assistant_work.chain import looks_chained

    assert looks_chained("మొదట కొత్త లీడ్స్ అందరికీ మెసేజ్ పంపు, ఆ తర్వాత రేపు ఉదయం 11కి విజిట్ బుక్ చేయి")
    assert looks_chained("पहले सबको संदेश भेजो, फिर विज़िट बुक करो")
    assert looks_chained("ಮೊದಲು ಸಂದೇಶ ಕಳುಹಿಸು, ನಂತರ ಭೇಟಿ ಬುಕ್ ಮಾಡು")
    assert not looks_chained("Call Ravi")
