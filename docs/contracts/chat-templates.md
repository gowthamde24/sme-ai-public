# Chats: promises, product and templates (16 Nov 2026)

Owner's Kavitha Gowda chat: the assistant promised "I will check the price and let you know", nothing followed, the customer asked again, and the 24-hour window closed.

## 1. A promise made in a chat is written down at once
After the assistant replies to a WhatsApp message (`app/autoreply/runner.py`), the worker calls `public.scheduler_auto_reply_note` (registered scheduler account only):
* **Promise**: the model flags `promises`, or the code (`rules.promises_follow_up`, English, Telugu, Hindi, Kannada) finds "I will check / confirm / send / get back" in the reply. It becomes an open `price_asks` row (`GET /price-asks`, Today's "Price asked" section) with `kind` `price` (the customer asked about money or the reply speaks of a price) or `follow_up`. One OPEN item per customer and kind: a later promise or deadline updates it.
* **Deadline**: `needed_by` is the day the customer named ("for Sunday", "by Friday", "tomorrow", "25 Nov", also in te/hi/kn), computed by code from India's today (`rules.needed_by_of`), never by the model. A later message that only names a day ("need it for Sunday") moves the deadline of the open item.
* **Product**: `profile.product` on the lead (`GET /leads/{id}/profile`, the lead card): up to 80 characters, from the model's `interested_in` (a short noun phrase), else a code guess from the customer's own words (`rules.product_of`); never the whole message. `profile.need` stays the customer's first words. A product the owner fixed is never overwritten. PII: erased with the workspace, swept on erasure, never in the audit trail.
* A failure here is a log line; the reply is always sent or held as before.

## 2. The chat's template picker (window closed)
* `GET /v1/tenants/{t}/conversations/{lead_id}/templates` (Owner, Admin, Sales) -> `{items: [{id, name, language, purpose, preview, variables: [{key: first_name|business_name|visit_time, label, value, editable: false}]}]}`. `visit_time` (16 Nov, owner) is the customer's next booked or confirmed visit as "Sat 22 Nov, 11:00 AM" (India time); a template that needs it (visit_reminder, visit_confirmation) is listed only when the customer has a visit coming, and is never sent with a blank. Only APPROVED templates of the customer's language (profile language, else the name's script, else the business language); a marketing-category template only when the customer has marketing consent; offers and reminders (campaigns) never. `preview` is exactly what goes out. Empty list: nothing approved.
* `POST /v1/tenants/{t}/conversations/{lead_id}/template` body `{template_id, message_id?}` -> the same answer as `POST /outbox/messages` (`{message: {status, reason, ...}, replayed, dispatched}`; status queued | needs_approval | blocked). There is no field for words or values. The message is an `owner` message of the category of the template's purpose; the outbox applies consent, STOP, quiet hours, the daily limit and the word check. The sender finds the template by the message's words (an edited message is no longer a template).

## 3. Marketing templates and the opt-out button
See `docs-private/plans/textiles-campaigns-marketing.md` (owner decisions 16 Nov 2026).
