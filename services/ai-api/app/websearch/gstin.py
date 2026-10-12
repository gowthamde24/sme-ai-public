"""GSTIN verification: NOT built against a real provider (job BP, ADR 0078). The GST portal's public "Search Taxpayer" is behind a captcha and has no public API; verified lookups come through GST Suvidha
Providers and resellers that sell them per call (for example annual plans from about Rs 3,500 for 5,000 calls, 2026 list prices read from a reseller's page; a few offer a trial of 5 to 50 calls). That is
a paid dependency, which ADR 0017 reserves for the owner's prior written approval, and no provider's terms or API were reviewed. The FORMAT and CHECKSUM of a GSTIN are validated offline (job CA). This file
holds only the interface a provider would implement and a fake, so a decision to buy a plan changes one adapter."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class GstinStatus:
    gstin: str
    exists: bool
    active: bool | None  # None = unknown
    legal_name: str | None
    state_code: str


class GstinVerifier(Protocol):
    def verify(self, gstin: str) -> GstinStatus: ...


class FixtureGstin:
    """Invented answers for tests: a GSTIN ending in 'Z5' is active, in 'Z1' cancelled, anything else unknown."""

    def verify(self, gstin: str) -> GstinStatus:
        if gstin.endswith("Z5"):
            return GstinStatus(gstin, True, True, "Invented Silks Private Limited", gstin[:2])
        if gstin.endswith("Z1"):
            return GstinStatus(gstin, True, False, "Invented Cancelled Traders", gstin[:2])
        return GstinStatus(gstin, False, None, None, gstin[:2])
