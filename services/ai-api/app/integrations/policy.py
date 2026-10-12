"""Which terms and privacy-notice versions are current. The API publishes them (settings TERMS_VERSION and PRIVACY_VERSION, so a new version is a configuration change plus the new text) and refuses
to record an acceptance of any other; the database keeps the evidence (public.policy_accept)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

DEFAULT_VERSION = "2026-10-01"


@dataclass(frozen=True)
class PolicyVersions:
    terms: str = DEFAULT_VERSION
    privacy: str = DEFAULT_VERSION
    # job BN: a version binds from its date (None = at once); the date is shown so a page can say "from 1 November"
    terms_effective_from: date | None = None
    privacy_effective_from: date | None = None

    def current(self) -> dict[str, dict[str, str]]:
        out = {"terms": {"version": self.terms}, "privacy": {"version": self.privacy}}
        if self.terms_effective_from is not None:
            out["terms"]["effective_from"] = self.terms_effective_from.isoformat()
        if self.privacy_effective_from is not None:
            out["privacy"]["effective_from"] = self.privacy_effective_from.isoformat()
        return out

    def matches(self, terms: str | None, privacy: str | None) -> bool:
        return (terms is None or terms == self.terms) and (privacy is None or privacy == self.privacy)
