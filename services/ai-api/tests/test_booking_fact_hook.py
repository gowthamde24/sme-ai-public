"""The owner's own booking page in the phone assistant's fact pack (commerce-notify section D): said only when the provider returns a fact."""

from __future__ import annotations

import uuid
from typing import Any

from app.calendar_in import links
from app.calendar_in.links import booking_link_fact
from app.telephony import fact_pack
from app.telephony.inbound_store import InboundStore


class _Store(InboundStore):
    def __init__(self) -> None:   # no database: _call answers a fixed pack
        self._packs: dict[Any, Any] = {}

    def _call(self, name: str, args: dict[str, Any]) -> Any:
        return {"hours": None}


def test_the_booking_fact_reaches_the_pack_only_when_the_provider_gives_one() -> None:
    tenant = uuid.uuid4()
    links.PROVIDER = None
    assert "booking_fact" not in (_Store().fact_pack(tenant) or {})
    links.PROVIDER = lambda t: booking_link_fact("https://calendly.com/demo/30min")
    try:
        pack = _Store().fact_pack(tenant) or {}
        built = fact_pack.build(pack)
        assert any(f["kind"] == "booking" and "https://calendly.com/demo/30min" in f["text"] for f in built.facts)
        links.PROVIDER = lambda t: None
        assert "booking_fact" not in (_Store().fact_pack(tenant) or {})
        links.PROVIDER = lambda t: (_ for _ in ()).throw(RuntimeError("down"))
        assert "booking_fact" not in (_Store().fact_pack(tenant) or {})
    finally:
        links.PROVIDER = None
