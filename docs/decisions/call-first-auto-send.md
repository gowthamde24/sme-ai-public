# Decision: call first; WhatsApp only on the customer's request (owner, 5 Nov 2026)

This is the written form of the "auto-send policy" decision that ADR 0066 and the speed-to-lead migrations refer to (it was never in the repository). It amends ADR 0066 and ADR 0108, decision 3.

## The rule
1. **A new lead is CALLED directly**: within the standing rule's minutes (default 2) inside calling hours. After hours the call is queued for the next morning (`night_call_minute`); **nothing is sent at night**.
2. **WhatsApp only when the customer asks or agrees on the call**:
   - they ask to be sent something on WhatsApp ("send photos", "send the quote", "message me"), recorded as `captured.whatsapp = "asked"`;
   - or they can't talk now and say yes to WhatsApp when it is offered, recorded as `captured.whatsapp = "agreed"` (the message now, the call at the agreed time).
   The message is the rule's or batch's Owner-approved text; it still goes through the outbox and every one of its blocks (STOP, consent, suppression, quiet hours, limits, kill switches).
3. **Retries follow the call settings** (`retry_busy`, `retry_no_answer`, `retry_call_later`: count and gap), or the pack's defaults when the workspace has not saved them. A school: fewer retries, wider apart. Voicemail, a failed call and a call with nothing decided count as no answer.
4. **After the last unanswered call: stop.** No automatic WhatsApp.
5. **No WhatsApp-first rule kinds.** `whatsapp_first`, `whatsapp_then_call` and a message-only rule for new leads are refused by the API and the database. Existing ones became "call within N minutes" (a message-only rule became "call and WhatsApp on request"). A batch with both channels calls first.
6. The Owner's own message campaign to a list (`channel = whatsapp` batch, approved once) is unchanged: it is not a new lead.

## Unchanged
- Real calls to customers' leads stay OFF until the lawyer review and registered numbers (sandbox and simulator only).
- Calls need the Owner's approval (a standing rule or a batch, approved once with the second factor).
- The model never decides a channel by itself: it only reports what the customer said (`asked` / `agreed` / nothing), and code checks the two words.

Built in migration `20261231140000_cf_call_first.sql` (pgTAP 160; 127 updated) and `app/telephony/outcome.py` (the `whatsapp` field).
