"""Campaigns S2: the API's models know what the database's offer functions return (a model that forbids extras would turn every preview into a 500)."""

from __future__ import annotations

from app.campaigns.models import CampaignDetailOut, CampaignOut, OfferCountsOut, PreviewOut


def test_the_preview_carries_the_offers_audience_and_the_other_models_do_not() -> None:
    assert "offer" in PreviewOut.model_fields and "offer" not in CampaignDetailOut.model_fields
    assert {"offer_label", "weekly_cap"} <= set(CampaignOut.model_fields)
    counts = OfferCountsOut.model_validate({"recipients": 5, "will_receive": 2, "left_out": {"stopped": 1, "marketing_withdrawn": 1, "no_marketing_consent": 1, "no_whatsapp": 0}, "cost": {"messages_at_most": 2, "paise_each": 60, "paise_at_most": 120, "rate_source": "estimate", "before_gst": True}})
    assert counts.will_receive == 2 and counts.left_out["stopped"] == 1
