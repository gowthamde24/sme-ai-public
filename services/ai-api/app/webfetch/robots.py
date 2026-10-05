"""robots.txt for the fetcher: what the site's owner allows our crawler to read.

The file is fetched THROUGH THE SAME GUARD as a page (the fetcher passes it down), so it cannot be
used to reach a private address. A site that cannot be asked is not read: any server error,
timeout, redirect off the site, oversized file or `401/403` means "disallow everything" (cached
for a short time); only a missing file (`404`, `410`) allows everything. A crawl delay longer than
the maximum we are willing to wait is a refusal, not something to ignore.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.robotparser import RobotFileParser

ROBOTS_TOKEN = "SmeAiResearchBot"  # noqa: S105  (a crawler name, not a secret)
ALLOW_CACHE_SECONDS = 3600.0
DENY_CACHE_SECONDS = 300.0


@dataclass(frozen=True)
class RobotsRules:
    """The parsed decision for one origin. `unavailable`: we could not ask, or may not read."""

    parser: RobotFileParser | None
    unavailable: bool = False

    def allows(self, path: str) -> bool:
        if self.unavailable:
            return False
        if self.parser is None:  # no robots.txt: everything is allowed
            return True
        return self.parser.can_fetch(ROBOTS_TOKEN, path)

    def crawl_delay(self) -> float:
        if self.parser is None or self.unavailable:
            return 0.0
        delay = self.parser.crawl_delay(ROBOTS_TOKEN)
        return float(delay) if delay is not None else 0.0


ALLOW_ALL = RobotsRules(parser=None)
DENY_ALL = RobotsRules(parser=None, unavailable=True)


def parse_robots(text: str) -> RobotsRules:
    parser = RobotFileParser()
    parser.parse(text.splitlines())
    return RobotsRules(parser=parser)
