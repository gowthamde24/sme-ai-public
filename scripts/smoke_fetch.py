"""Fetch-only smoke test of the REAL page fetcher (T007 M1). Opt-in: `make smoke-fetch`.

No model, no key, no cost, no database. It fetches https://example.com/ and https://example.org/
through the same guarded fetcher the research agent will use (SSRF guard, robots.txt, limits,
sanitiser) and prints, per URL, ONLY the status, the number of bytes read, the content type and
the length of the sanitised text. It never prints page text.

Exit code 0 when every URL was fetched, 1 otherwise.
"""

from __future__ import annotations

import sys
from collections.abc import Sequence

from app.agents.web import FetchError, PageFetcher
from app.webfetch.fetcher import make_default_fetcher

URLS = ("https://example.com/", "https://example.org/")


def run(fetcher: PageFetcher, urls: Sequence[str]) -> tuple[list[str], bool]:
    lines: list[str] = []
    ok = True
    for url in urls:
        try:
            page = fetcher.fetch(url)
        except FetchError as error:
            lines.append(f"{url} refused code={error.code} status={error.status or '-'}")
            ok = False
        else:
            lines.append(
                f"{url} status={page.status} bytes={page.body_bytes} "
                f"content_type={page.content_type} text_chars={len(page.text)}"
            )
    return lines, ok


def main() -> int:
    lines, ok = run(make_default_fetcher(), URLS)
    print("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
