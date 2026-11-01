"""Answer-wording checks (owner review, 1 Nov 2026): the assistant never READS OUT a zero. "₹0.00 money is held" is "No money is pending"; "0 new enquiries" is "There are no new enquiries".
The rule itself is in the prompt (`prompts.ZERO_RULE`); `reads_a_zero` is the check the evals use on real replies (it is not applied to what a person sees at run time: a regex cannot rewrite a sentence safely)."""

# ruff: noqa: E501
from __future__ import annotations

import re

_MONEY = re.compile(r"(?:₹|\brs\.?|\binr\b|రూ\.?|रु\.?|ரூ\.?|ರೂ\.?|രൂ\.?)\s?0+(?:[.,]0+)?(?![\d.,]*[1-9])", re.IGNORECASE)
_WORD_ZERO_MONEY = re.compile(r"(?:\b0+(?:[.,]0+)?\s?(?:rupees?|rs\b|inr\b)|\bzero\s+(?:rupees?|amount|orders?|enquiries|inquiries|leads?|customers?|quotes?|payments?)|సున్నా\s?(?:రూపాయ|ఆర్డర్|ఎంక్వైరీ|లీడ్|కస్టమర్)|0\s?రూపాయ)", re.IGNORECASE)
_COUNT = re.compile(r"(?<![\d.,:/\-₹])\b0\b(?![\d.,:/%\-])\s*(?!%)(?:new\s+|open\s+|pending\s+|waiting\s+)?(?:orders?|enquiries|inquiries|leads?|customers?|quotes?|payments?|follow-?ups?|messages?|items?|approvals?|visits?|dues?|invoices?|ఆర్డర్|ఎంక్వైరీ|లీడ్|కస్టమర్|కొటేషన్|చెల్లింపు|మెసేజ్|ऑर्डर|लीड|ग्राहक|पूछताछ|ಆರ್ಡರ್|ಲೀಡ್|ಗ್ರಾಹಕ)", re.IGNORECASE)


def reads_a_zero(text: str) -> bool:
    """True when the reply reads out a zero amount or a zero count ("₹0.00", "Rs 0", "0 rupees", "రూ.0", "0 new enquiries", "zero orders")."""
    return bool(_MONEY.search(text) or _WORD_ZERO_MONEY.search(text) or _COUNT.search(text))
