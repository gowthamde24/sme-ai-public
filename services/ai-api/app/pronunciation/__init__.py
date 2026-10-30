"""Pronunciation quality (job pronunciation-quality, owner 30 Oct 2026: "everything it says must be pronounced correctly"): fixed as a SYSTEM, not word by word.

  numbers.py    numbers as people say them, in the six languages
  normalise.py  written text -> said text (money, dates, times, phone numbers, units, abbreviations, links, emoji ...)
  lexicon.py    words an engine gets wrong: a shared lexicon (places, names, pack words, brand words) and a workspace's own words, in the script of each voice's language
  qa.py         the round trip: speak -> Sarvam speech-to-text -> compare; ranked mismatches, the weekly review export
"""

# ruff: noqa: E501
