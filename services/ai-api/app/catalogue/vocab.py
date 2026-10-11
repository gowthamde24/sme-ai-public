"""The catalogue's closed words and how they read to a person (job AY). The database holds the same lists in CHECK constraints; a test pins that they agree."""

from __future__ import annotations

from typing import Literal

Fabric = Literal[
    "kanchi_pattu",
    "dharmavaram_silk",
    "soft_silk",
    "cotton_silk",
    "banarasi",
    "mysore_silk",
    "uppada",
    "pure_cotton",
    "georgette",
    "other",
]
Colour = Literal[
    "red", "maroon", "pink", "orange", "yellow", "green", "blue", "navy", "purple", "black", "white", "cream", "gold", "silver", "brown", "grey", "multi"
]  # fmt: skip
Zari = Literal["none", "light", "rich"]
Occasion = Literal["wedding", "festival", "daily", "party"]
PriceBand = Literal["under_5k", "5k_10k", "10k_25k", "25k_50k", "above_50k"]
Stock = Literal["in_stock", "few_left", "made_to_order"]

FABRICS: tuple[str, ...] = Fabric.__args__  # type: ignore[attr-defined]
COLOURS: tuple[str, ...] = Colour.__args__  # type: ignore[attr-defined]
OCCASIONS: tuple[str, ...] = Occasion.__args__  # type: ignore[attr-defined]
PRICE_BANDS: tuple[str, ...] = PriceBand.__args__  # type: ignore[attr-defined]

FABRIC_LABEL: dict[str, str] = {
    "kanchi_pattu": "Kanchi pattu",
    "dharmavaram_silk": "Dharmavaram silk",
    "soft_silk": "Soft silk",
    "cotton_silk": "Cotton silk",
    "banarasi": "Banarasi",
    "mysore_silk": "Mysore silk",
    "uppada": "Uppada",
    "pure_cotton": "Pure cotton",
    "georgette": "Georgette",
    "other": "Other",
}
# the band as a customer would be told it. A band is money: a message that carries this text waits for a person (the outbox policy sees the rupee sign).
BAND_LABEL: dict[str, str] = {
    "under_5k": "under ₹5,000",
    "5k_10k": "₹5,000 to ₹10,000",
    "10k_25k": "₹10,000 to ₹25,000",
    "25k_50k": "₹25,000 to ₹50,000",
    "above_50k": "above ₹50,000",
}
STOCK_LABEL: dict[str, str] = {
    "in_stock": "In stock",
    "few_left": "Few left",
    "made_to_order": "Made to order",
}


# plain words an owner or a model may use for a fabric -> the catalogue's closed list (the assistant's find tool and the scripted development model)
FABRIC_ALIASES = {
    "kanjivaram": "kanchi_pattu", "kanchipuram": "kanchi_pattu", "kanchi": "kanchi_pattu", "pattu": "kanchi_pattu", "kanchi_pattu": "kanchi_pattu",
    "dharmavaram": "dharmavaram_silk", "dharmavaram_silk": "dharmavaram_silk", "soft_silk": "soft_silk", "soft": "soft_silk",
    "cotton_silk": "cotton_silk", "banarasi": "banarasi", "benarasi": "banarasi", "mysore": "mysore_silk", "mysore_silk": "mysore_silk",
    "uppada": "uppada", "cotton": "pure_cotton", "pure_cotton": "pure_cotton", "georgette": "georgette", "other": "other",
}  # fmt: skip
