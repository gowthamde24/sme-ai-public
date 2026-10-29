#!/usr/bin/env python3
"""Build the voice catalogue v2 (job voice-system-v2, owner 29 Oct 2026). OPT-IN: it spends Cartesia and Sarvam characters; both keys come from the environment (CARTESIA_API_KEY, SARVAM_API_KEY).

    CARTESIA_API_KEY=... SARVAM_API_KEY=... python scripts/voice_catalogue_build.py [--write] [--per-gender 5]

For each language (te, en, hi, kn, ta, ml) and gender it takes the NATIVE Cartesia voices (a voice made for that language: never an English voice speaking Telugu; English prefers Indian-accent voices),
renders the language's sample line with each (the same line for every voice), reads it back with Sarvam speech-to-text in the language's own script and scores the round trip (character similarity to the
line). The best scores become the catalogue (up to --per-gender per language and gender), the top three are "recommended", the best one is the default (en female stays Janvi, and a voice that is
already in the catalogue keeps its id). Style tags come from the provider's own description. Without --write it only prints the table; with it, it writes app/conversation/data/voices.json and the
sample mp3 of every chosen voice. The fillers are rendered afterwards by scripts/voice_filler_bank.py.
"""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.conversation.voices import DEFAULT_FILE, SAMPLES, sample_text  # noqa: E402

LANGS = ("te", "en", "hi", "kn", "ta", "ml")
GENDER = {"feminine": "female", "masculine": "male"}
MODEL = "sonic-3.6"
STT_TAG = {"te": "te-IN", "en": "en-IN", "hi": "hi-IN", "kn": "kn-IN", "ta": "ta-IN", "ml": "ml-IN"}
KEEP_FIRST = {"en-janvi": "7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8"}   # the English default that has always been Janvi

# the Bulbul v4 Flash voice behind each (language, gender) for an outage. Bulbul v3 is never used (owner decision 28 Oct): Malayalam and Tamil women have no v4 voice of their own, so a Hindi v4 voice of the same gender backs them up (an approximate outage fallback; verify when Sarvam credits allow)
FALLBACK = {
    ("te", "female"): ("bulbul:v4-flash", "kavitha_te_conversation"), ("te", "male"): ("bulbul:v4-flash", "tarun_te_narration"),
    ("en", "female"): ("bulbul:v4-flash", "shalini_en_customer"), ("en", "male"): ("bulbul:v4-flash", "shubh_enhi_customer"),
    ("hi", "female"): ("bulbul:v4-flash", "kavya_hi_conversational"), ("hi", "male"): ("bulbul:v4-flash", "kabir_hi_conversational"),
    ("kn", "female"): ("bulbul:v4-flash", "chaitra_kn_conversation"), ("kn", "male"): ("bulbul:v4-flash", "chetan_kn_conversation"),
    ("ta", "female"): ("bulbul:v4-flash", "roopa_hi_conversational"), ("ta", "male"): ("bulbul:v4-flash", "gokul_ta_narration"),
    ("ml", "female"): ("bulbul:v4-flash", "roopa_hi_conversational"), ("ml", "male"): ("bulbul:v4-flash", "kabir_hi_conversational"),
}

KEYWORDS = {
    "calm": ("calm", "soothing", "steady", "measured", "composed", "gentle", "serene", "relaxed"),
    "warm": ("warm", "friendly", "caring", "kind", "empathetic", "nurturing", "reassuring", "welcoming", "comfort"),
    "deep": ("deep", "low", "rich", "resonant", "baritone", "grounded", "authority", "authoritative"),
    "bright": ("bright", "clear", "crisp", "cheerful", "upbeat", "joyful", "sunny", "light"),
    "young": ("young", "youthful", "playful", "casual", "fresh", "buddy", "pal", "mate"),
    "mature": ("mature", "seasoned", "professional", "polished", "elegant", "expert", "sophisticated", "orator", "narrator"),
    "energetic": ("energetic", "dynamic", "enthusiastic", "vibrant", "lively", "expressive", "spirited", "excited"),
}


def tags_of(name: str, description: str) -> list[str]:
    text = f"{name} {description}".lower()
    found = [t for t, words in KEYWORDS.items() if any(re.search(rf"\b{w}\b", text) for w in words)]
    return (found or ["calm"])[:3]


def slug(name: str) -> str:
    base = unicodedata.normalize("NFKD", name.split(" - ")[0]).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", base)[:30]


def norm(text: str) -> str:
    return re.sub(r"[^\w]", "", unicodedata.normalize("NFC", text).lower())


def native(voices: list[dict], lang: str) -> list[dict]:
    got = [v for v in voices if v.get("language") == lang and v.get("is_public", True)]
    if lang == "en":
        indian = [v for v in got if any(str(a.get("locale", "")).endswith("-IN") for a in v.get("accents") or []) or v.get("country") == "IN"]
        got = indian or got
    return got


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--per-gender", type=int, default=5)
    ap.add_argument("--no-render", action="store_true", help="choose from the provider's list and descriptions only (no audio, no credits): used while the Cartesia credits are empty; samples and fillers are rendered later")
    ap.add_argument("--candidates", type=int, default=8, help="how many native voices per language and gender are rendered and scored")
    args = ap.parse_args()
    ckey, skey = os.environ.get("CARTESIA_API_KEY", ""), os.environ.get("SARVAM_API_KEY", "")
    if not ckey or (not skey and not args.no_render):
        print("set CARTESIA_API_KEY and SARVAM_API_KEY in the environment", file=sys.stderr)
        return 2
    old = {v["id"]: v for v in json.loads(Path(DEFAULT_FILE).read_text(encoding="utf-8"))["catalogue"]}
    chars_sent, rows, catalogue, mp3s = 0, [], [], {}
    with httpx.Client(timeout=90) as http:
        for lang in LANGS:
            text = sample_text(lang)
            for api_gender, gender in GENDER.items():
                r = http.get("https://api.cartesia.ai/voices", params={"language": lang, "gender": api_gender, "limit": 100}, headers={"X-API-Key": ckey, "Cartesia-Version": "2025-04-16"})
                r.raise_for_status()
                data = r.json().get("data", r.json())
                cands = native(data, lang)
                # voices already in the catalogue, and the English default, are always scored
                keep = {v["primary"]["voice"] for i, v in old.items() if v["language"] == lang and v["gender"] == gender} | ({KEEP_FIRST["en-janvi"]} if lang == "en" and gender == "female" else set())
                have = {v["id"] for v in cands}
                for missing in keep - have:   # a voice already in the catalogue is always a candidate, even when the list above did not carry it
                    g = http.get(f"https://api.cartesia.ai/voices/{missing}", headers={"X-API-Key": ckey, "Cartesia-Version": "2025-04-16"})
                    if g.status_code == 200:
                        cands.append(g.json())
                cands = [v for v in cands if v["id"] in keep] + [v for v in cands if v["id"] not in keep][: max(0, args.candidates - len(keep))]
                scored = []
                for v in cands:
                    if args.no_render:
                        text_l = f"{v['name']} {v.get('description', '')}".lower()
                        fit = (3.0 if v["id"] in keep else 0.0) + (10.0 if any(o["primary"]["voice"] == v["id"] and o.get("default") for o in old.values()) else 0.0) + sum(1.0 for w in ("assistant", "support", "friendly", "warm", "calm", "professional", "concierge", "agent", "conversation", "clear", "guide", "host") if w in text_l) - sum(2.0 for w in ("narrator", "folk", "studio", "character", "storyteller", "kids", "cartoon") if w in text_l)
                        scored.append((fit, v, b"", ""))
                        continue
                    t = http.post("https://api.cartesia.ai/tts/bytes", headers={"X-API-Key": ckey, "Cartesia-Version": "2025-04-16"},
                                  json={"model_id": MODEL, "transcript": text, "voice": {"mode": "id", "id": v["id"]}, "language": lang, "output_format": {"container": "mp3", "sample_rate": 44100, "bit_rate": 96000}})
                    chars_sent += len(text)
                    if t.status_code != 200:
                        continue
                    s = http.post("https://api.sarvam.ai/speech-to-text", headers={"api-subscription-key": skey}, data={"model": "saaras:v4", "language_code": STT_TAG[lang]}, files={"file": ("sample.mp3", t.content, "audio/mpeg")})
                    heard = s.json().get("transcript", "") if s.status_code == 200 else ""
                    score = difflib.SequenceMatcher(None, norm(heard), norm(text)).ratio()
                    scored.append((score, v, t.content, heard))
                scored.sort(key=lambda x: -x[0])
                picked = scored[: args.per_gender]
                # keep what is already in the catalogue (so no workspace's choice breaks), then fill with the best
                for sc, v, mp3, heard in scored:
                    vid = f"{lang}-{slug(v['name'])}"
                    if vid in old and (sc, v, mp3, heard) not in picked:
                        picked.append((sc, v, mp3, heard))
                recommended_count = 1 if len(picked) <= 2 else (2 if len(picked) == 3 else 3)   # "Recommended" is a pick, not a label on everything
                for rank, (sc, v, mp3, heard) in enumerate(sorted(picked, key=lambda x: -x[0])):
                    name = v["name"].split(" - ")[0].strip()
                    vid = f"{lang}-{slug(v['name'])}"
                    model, speaker = FALLBACK[(lang, gender)]
                    old_default = next((i for i, o in old.items() if o["language"] == lang and o["gender"] == gender and o.get("default")), None)
                    is_default = (vid == old_default) if old_default is not None else rank == 0   # whoever has always spoken stays the default (te Ramya, en Janvi, ...); a new group takes its best score
                    tags = tags_of(v["name"], v.get("description", ""))
                    catalogue.append({
                        "id": vid, "language": lang, "name": name, "label": tags[0].capitalize(), "gender": gender, "tags": tags, "recommended": rank < recommended_count or vid == "en-janvi", "default": is_default,
                        "primary": {"engine": "cartesia", "model": MODEL, "voice": v["id"], "label": name},
                        "fallback": {"engine": "sarvam_v4", "model": model, "voice": speaker, "gender": gender, "label": speaker.split("_")[0]},
                    })
                    mp3s[vid] = mp3
                    rows.append((vid, gender, round(sc, 2), tags))
    # exactly one default per language and gender
    for lang in LANGS:
        for gender in ("female", "male"):
            group = [c for c in catalogue if c["language"] == lang and c["gender"] == gender]
            if group and not any(c["default"] for c in group):
                group[0]["default"] = True
    print(f"{len(catalogue)} voices chosen; {chars_sent} Cartesia characters sent (the voices, tags and defaults are in voices.json when --write is given)")
    if not args.write:
        print("(dry run: nothing written; add --write)")
        return 0
    data = json.loads(Path(DEFAULT_FILE).read_text(encoding="utf-8"))
    data["catalogue"] = catalogue
    data["$comment"] = data["$comment"].split(" Voice system v2")[0] + " Voice system v2 (29 Oct 2026): native Cartesia voices of both genders in te, en, hi, kn, ta, ml, built by scripts/voice_catalogue_build.py; tags in plain words; recommended = the best three by a speech-to-text round trip."
    Path(DEFAULT_FILE).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    SAMPLES.mkdir(parents=True, exist_ok=True)
    if not args.no_render:
        for old_file in SAMPLES.glob("*.mp3"):
            old_file.unlink()
        for vid, mp3 in mp3s.items():
            (SAMPLES / f"{vid}.mp3").write_bytes(mp3)
    print("written:", DEFAULT_FILE, f"and {len(mp3s) if not args.no_render else 0} samples")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
