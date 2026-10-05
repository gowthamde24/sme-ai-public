# ADR 0018: Enquiries, requirements and the Requirement Agent (T008)

Status: accepted for the local-first stage (owner review of commits 1-3 on 2026-10-05; plan: `docs/plans/t008-requirement-agent.md`). Related: ADR 0013 (agents),
ADR 0014 (erasure), ADR 0017 (local-first), `docs/plans/t009-quote-engine.md`, `docs/plans/t010-followup-cadence.md`.

## Context
After "Reply / Enquiry Captured" the product needs a structured requirement before any quote: what saree, how many, by when, to where, how paid. A customer writes that
in an e-mail or a WhatsApp message. The text is untrusted (anyone can write it), personal (names, numbers) and ambiguous. An agent can read it faster than a person, but
nothing it says may become a business fact, a price or a message without a person.

## Decisions
**1. A requirement is its own thing, not a claim.** `enquiries` (text, immutable except archive), `requirements` (one per extraction run; at most ONE active: draft or confirmed, a partial
unique index) and `requirement_fields` (typed values). Claims stay what they were: one predicate about a company that the ICP score reads.

**2. Scrub before store; the original is kept nowhere.** A person pastes the text on a lead. Capture strips invisible characters (zero-width, bidi, control, tag) and removes e-mail addresses
and Indian mobile numbers (`app/requirements/capture_text.py`, `scrub.py`), then cuts at 6,000 characters. The database refuses any subject or body that still matches the same two
patterns (`app.text_has_contact`, a CHECK). The scrubber is conservative on purpose: amounts, quantities, dates, GSTINs, pincodes and PO / order numbers are never altered. Limits: a phone
in an unusual grouping, a name inside the text. **Indic joiners:** the database accepts ZWJ / ZWNJ and LRM / RLM (legal in Indic and Persian scripts); capture strips them (decision), which can change
how a conjunct renders but not the letters. `KEEP_INDIC_JOINERS` keeps them between Indic letters if the owner prefers.

**3. The model points at words; deterministic code does the rest.** `propose_field` gives a line, a field, the value as the enquiry words it, a certainty and a QUOTE (a string). The runtime finds the
offsets (whitespace-normalised, first occurrence), normalises the value (quantity, money in paise, dates resolved in **Asia/Kolkata**, city, payment terms; the quote engine's bounds: quantity per line
1..10,000, per-piece budget <= INR 1,000,000, total budget <= INR 10,000,000, net days 0..180), requires the quote to SUPPORT the value (numbers and dates must appear in it, a choice needs a synonym), takes the worse of the model's
and the normaliser's certainty (a relative date is `implied`; a range, a missing budget basis, one end of a range quoted alone, are `ambiguous`), and holds the proposal. At the end of a run that finished well each slot
is written once; two different values for one slot are written as ONE `ambiguous` field with the conflict flag. A failed run writes nothing. A festival or a season is never resolved to a date.

**4. The database verifies what it can.** `agent_write_requirement_field` re-checks the quote against the stored enquiry text (offsets in characters; whitespace = space, tab, CR, LF, the same rule as the finder, proven
equal by a property test through the real stack), the value's shape and caps (`app.requirement_value_ok`), one field per slot, the write budget, and the run (the starter's, a requirement run on an enquiry). A delivery city must appear in
its quote. This closes the limit T007 had (the database never saw the page). What stays with the runtime: the value-in-span check (it needs the normalisers), the range context, the vocabulary synonyms.

**5. People decide, and only people.** `decide_requirement_field` (confirm | correct | reject), `add_requirement_field` (a field the extraction missed; stored `corrected`, `manual`), `confirm_requirement`,
`discard_requirement`: Owner / Admin / Sales; an unknown id and another tenant's id are the same refusal. A correction is written in the person's words and read by the SAME normalisers.
**Confirm needs a saree type AND a quantity on the same line, each confirmed or corrected by a person: nothing else blocks it.** The delivery city, the deadline and the payment terms are "needed before quote": they are asked for and tracked by a
separate `ready_for_quote` flag. Both flags are computed at read time by rules (`app/requirements/policy.py`), never by a model. SM208 (the enquiry already has a confirmed requirement), SM209 (not a draft), SM210 (not confirmable).

**6. Questions are derived, not stored.** The flags (missing, low-certainty, conflicting) become clarifying questions through closed templates at read time. A question echoes only closed values (a saree type, a
number of pieces, a date), never the customer's words, a name, a link or a price, so an enquiry cannot put words into a message a person might send. The screen shows the text and a Copy button. **Nothing is persisted and nothing is sent.
Persisted question drafts (and any approval state for them) belong to the T010 integration.**

**7. `requirement_v1`** (security-invoker view): the confirmed / corrected fields of a CONFIRMED requirement, no quote, no enquiry text. It is the contract the quote ticket reads.
**Discarding a confirmed requirement must be blocked once a quote depends on it: the T009 integration adds that check** (today a person may discard it, which hides its fields from the view).

**8. The agent is the least privileged one so far.** The `requirement` definition has NO claim predicates and NO evidence kinds (the definition table now allows empty lists for this), its own switch (OFF), allowed for no tenant
until the operator names one, and a run only ever targets an enquiry (and no other agent may). The delegated token is the starting human's (option A): the decision functions are reachable with it, like `review_claim`; the sandbox has no code path
to them (`tests/test_agents_boundary.py`, which now also scans the pure `app/requirements` package). Option B stays required before any scheduled run or external customer.

## Evidence it holds
pgTAP 53-55; real-stack direct-PostgREST attacks and Python/database equivalence properties (guard, quote, add); injection evals E01-E15 and N20-N31 with a diff of the whole tenant before and after (no evidence, claims, links or
reviews appear; every field is an undecided proposal whose quote is at its offsets); a golden set of 20 enquiries with a committed report and THE GATE (zero `stated` fields that are wrong or unasked for; the first run found one, a quote of one end of a range, now `ambiguous`).
The scripted model is a stand-in: real quality is measured only with a real model after the owner's written approval (ADR 0017 b).

## Consequences and limits
* Names remain in enquiry text after contact scrubbing (ADR 0014, the limit of names); a provider would see them: a DPDP / cross-border decision before the first live call (T012).
* The caps guard against bugs and honest mistakes, not a malicious member (ADR 0013).
* A city in a non-Latin script is not supported by the span check (the agent abstains; a person adds it). Quantity words in Hindi are limited to a short list.
* `enquiries.retain_until` is the hook for a later retention rule (a function and a job, not a table change). Until then text is kept until erased (erasure reaches the body, the subject, every quote and city).
* The definition's input ceiling is 40,000 tokens (a 6,000-character Indic text is up to 18,000 bytes).
* Not built: sending, e-mail / WhatsApp integration, attachments, SKU matching, any price or quote calculation, order creation, model-written text of any kind.
