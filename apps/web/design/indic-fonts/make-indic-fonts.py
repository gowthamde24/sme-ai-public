#!/usr/bin/env python3
"""Regenerates the three Indic web fonts in this folder (job CH). A developer tool: never run by the build, the tests or CI.

  python3 -I design/indic-fonts/make-indic-fonts.py          # from apps/web; needs `fontTools` and `brotli` (pip), and network for fonts.googleapis.com

What it does: downloads Google's own per-script file of Noto Sans Telugu / Devanagari / Kannada (the variable font, weights 100 to 900, already cut to that script's letters),
and limits the weight axis to 400 to 700 (the weights the app uses: normal, medium, semibold, bold). Nothing else is removed: every letter, mark and shaping rule of the script stays, so
conjuncts (a consonant joined to the next) still form. Output: NotoSans<Script>-400-700.woff2, about 40 to 55 per cent smaller than the 100-900 file. The fonts are SIL OFL 1.1 (OFL.txt).
Why not cut by letter ranges (as Google does for Latin): a Telugu / Hindi / Kannada syllable is shaped as one run; splitting a script over two files would break the joined letters.
"""
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"  # Google serves woff2 to a current browser
SCRIPTS = {"Telugu": "telugu", "Devanagari": "devanagari", "Kannada": "kannada"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        return r.read()


def script_file_url(family: str, subset: str) -> str:
    css = fetch("https://fonts.googleapis.com/css2?" + urllib.parse.urlencode({"family": f"Noto Sans {family}:wght@100..900", "display": "swap"})).decode()
    for block in re.findall(r"/\* ([a-z-]+) \*/\s*@font-face\s*\{(.*?)\}", css, re.S):
        if block[0] == subset:
            return re.search(r"url\((https://[^)]+)\)", block[1]).group(1)
    raise SystemExit(f"no {subset} face in Google's answer for Noto Sans {family}")


def main() -> int:
    tmp = HERE / ".download.woff2"
    for family, subset in SCRIPTS.items():
        tmp.write_bytes(fetch(script_file_url(family, subset)))
        font = TTFont(tmp)
        small = instancer.instantiateVariableFont(font, {"wght": (400, 700)}, inplace=False)
        small.flavor = "woff2"
        out = HERE / f"NotoSans{family}-400-700.woff2"
        small.save(out)
        print(f"{out.name}: {tmp.stat().st_size} -> {out.stat().st_size} bytes, {len(small.getGlyphOrder())} glyphs")
    tmp.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
