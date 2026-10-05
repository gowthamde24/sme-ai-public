"""What the Research Agent may claim: the four predicates the ICP profile reads, and for each the
closed list of values (slugs) from that profile's vocabulary. The model never writes free text
into a claim: a value outside its predicate's list is refused before any database call.

`tests/test_research_vocab.py` keeps this equal to the ICP template
(config/icp/silk-wholesale.v1.json) and to the database's `agent_definitions` row, so the three
cannot drift apart."""

from __future__ import annotations

CLAIM_VOCAB: dict[str, tuple[str, ...]] = {
    "buyer_type": (
        "saree_shop",
        "wholesaler",
        "boutique",
        "multi_brand_store",
        "regional_chain",
        "other",
        "consumer",
    ),
    "order_scale": ("five_or_more_per_order", "fewer_than_five_per_order"),
    "size_band": ("large", "medium", "small", "micro"),
    "operating_status": ("active", "inactive", "closed"),
}
PREDICATES = tuple(CLAIM_VOCAB)
