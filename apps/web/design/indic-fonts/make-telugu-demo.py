"""Builds NotoSansTelugu-demo.woff2: the Telugu font cut down to the letters of the home page's sample call (chat-stack.ts) and the language names, for every page that is NOT in Telugu (they show Telugu only in that sample, so they do not need all 67 KB of the full font; a Telugu page uses the full file). Needs fontTools + brotli.
Run from apps/web:  python3 design/indic-fonts/make-telugu-demo.py   (then commit the .woff2 and the .codepoints.txt: components/v2/site/home/telugu-demo-font.test.ts checks that every Telugu letter of the sample is in the list)."""
import subprocess

src = open("components/v2/site/home/chat-stack.ts", encoding="utf8").read() + open("i18n/site-lang.ts", encoding="utf8").read() + "తెలుగు"
chars = sorted({c for c in src if 0x0C00 <= ord(c) <= 0x0C7F})
open("design/indic-fonts/NotoSansTelugu-demo.codepoints.txt", "w", encoding="utf8").write("".join(chars) + "\n")
uni = ",".join("U+%04X" % ord(c) for c in chars) + ",U+200C,U+200D,U+0020"
subprocess.run(["pyftsubset", "design/indic-fonts/NotoSansTelugu-400-700.woff2", "--unicodes=" + uni, "--flavor=woff2", "--layout-features=*", "--no-hinting", "--desubroutinize", "--output-file=design/indic-fonts/NotoSansTelugu-demo.woff2"], check=True)
