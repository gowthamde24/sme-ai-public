"""Which terms and privacy-notice versions are current. The API publishes them (settings TERMS_VERSION and PRIVACY_VERSION, so a new version is a configuration change plus the new text) and refuses
to record an acceptance of any other; the database keeps the evidence (public.policy_accept)."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_VERSION = "2026-10-01"


@dataclass(frozen=True)
class PolicyVersions:
    terms: str = DEFAULT_VERSION
    privacy: str = DEFAULT_VERSION

    def current(self) -> dict[str, dict[str, str]]:
        return {"terms": {"version": self.terms}, "privacy": {"version": self.privacy}}

    def matches(self, terms: str | None, privacy: str | None) -> bool:
        return (terms is None or terms == self.terms) and (privacy is None or privacy == self.privacy)
