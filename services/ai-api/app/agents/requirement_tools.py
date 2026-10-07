"""The Requirement Agent's one tool (T008): `propose_field`, and the flush that writes what it proposed.

What the runtime does BEFORE anything is kept (the model only points at words):
  * the quote (a STRING) is found in the stored enquiry text, whitespace-normalised, first occurrence; the runtime, not the model,
    computes the offsets (owner change C). A quote that is not there is refused and counted.
  * the value, as the enquiry words it, is normalised by deterministic code (quantity, money in paise, dates in Asia/Kolkata,
    city, payment terms, vocabulary) with the quote-engine caps; an unparseable or over-cap value is refused.
  * the value must be SUPPORTED by the quote (owner change D): a number or date must appear in it, a choice needs a synonym,
    a city must appear. Otherwise refused.
  * the certainty is the worse of the model's and the normaliser's (a relative date is `implied`; a range or a missing budget
    basis is `ambiguous`), and a number that is one end of a range in the text around its quote ("20-30", quoted as "30") is `ambiguous`.
Proposals are held in memory per (line, field). At the END of a run that finished well (`flush_proposals`, called by the runtime
after a valid final result) each slot is written once through the database function, which verifies the quote again against the
stored text and the value again against its shape and caps. A slot proposed twice with DIFFERENT values is written once, as
`ambiguous` with the conflict flag set: the enquiry contradicts itself and a human decides. A run that fails writes nothing.
No tool writes a question, a flag, a confirmation, a status or any free text.
"""

from __future__ import annotations

from app.agents.errors import ValueRefused
from app.agents.notes import NOTE_QUOTE_REFUSED, NOTE_RECORDED, NOTE_REFUSED, NOTE_VALUE_REFUSED
from app.agents.schemas import ProposeFieldArgs
from app.agents.tools import Proposal, Tool, ToolContext
from app.requirements.normalise import Refused, normalise, worse
from app.requirements.policy import QUESTION_ORDER
from app.requirements.quote import find_quote, normalise_ws
from app.requirements.span import in_range_context, supports

MAX_FIELDS = 40  # distinct (line, field) slots; the database allows the same
MAX_PROPOSALS = 60  # every call counted, so a loop cannot spin


def _propose_field(ctx: ToolContext, args: ProposeFieldArgs) -> str:
    state, enquiry = ctx.state, ctx.state.enquiry
    if enquiry is None or state.proposal_count >= MAX_PROPOSALS:
        return NOTE_REFUSED
    slot = (args.line, args.field)
    if slot not in state.proposals and len(state.proposals) >= MAX_FIELDS:
        return NOTE_REFUSED
    span = find_quote(enquiry.body, args.quote)
    if span is None:
        return NOTE_QUOTE_REFUSED
    quote = normalise_ws(args.quote)
    try:
        normalised = normalise(args.field, args.value, enquiry.received_at)
    except Refused:
        return NOTE_VALUE_REFUSED
    if not supports(args.field, normalised.value, quote, enquiry.received_at):
        return NOTE_VALUE_REFUSED
    certainty = worse(args.certainty, normalised.certainty)
    if args.field in ("quantity", "budget", "payment_terms") and in_range_context(
        enquiry.body, *span
    ):
        certainty = worse(certainty, "ambiguous")  # one end of a range is not a stated number
    proposal = Proposal(
        value=normalised.value,
        certainty=certainty,
        quote=quote,
        start=span[0],
        end=span[1],
    )
    state.proposals.setdefault(slot, [])
    if not any(p.value == proposal.value for p in state.proposals[slot]):
        state.proposals[slot].append(proposal)
    state.proposal_count += 1
    return NOTE_RECORDED


def flush_proposals(ctx: ToolContext) -> int:
    """Write each proposed slot once, in a fixed order. Called by the runtime after a valid final result. A slot the database
    refuses (it checks the quote and the value again) is skipped and counted; any other failure ends the run."""
    refused = 0
    order = {key: i for i, key in enumerate(QUESTION_ORDER)}
    for (line, key), items in sorted(
        ctx.state.proposals.items(), key=lambda kv: (kv[0][0] or 0, order[kv[0][1]])
    ):
        first = items[0]
        conflict = len(items) > 1  # proposals are kept only when their values differ
        value = first.value
        try:
            ctx.db.write_requirement_field(
                f"f{line or 0}-{key}",
                line=line,
                key=key,
                value_code=value.code,
                value_int=value.int_value,
                value_date=value.date_value.isoformat() if value.date_value else None,
                value_text=value.text,
                basis=value.basis,
                certainty="ambiguous" if conflict else first.certainty,
                quote=first.quote,
                start=first.start,
                end=first.end,
                conflict=conflict,
            )
        except ValueRefused:
            refused += 1
    return refused


PROPOSE_FIELD = Tool(
    "propose_field",
    "Propose ONE field of the customer's order. line: 1-5 for saree_type, fabric, colour and quantity "
    "(one number per order line); leave it out for budget, deadline, delivery_city and payment_terms. "
    "value: the value as the enquiry words it ('20', 'Kanchipuram', 'next Friday', 'Rs 5k each', "
    "'Hyderabad', '30 days credit'). certainty: stated, implied or ambiguous. quote: words copied EXACTLY from "
    "the enquiry that say it. If the enquiry does not say, propose nothing.",
    ProposeFieldArgs,
    _propose_field,
)
