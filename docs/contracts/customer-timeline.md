# One customer's timeline (app v4, part 3)

`GET /v1/tenants/{tenant_id}/customers/{lead_id}/timeline?before=<ISO time>&limit=<1..100, default 50>`. Any member can call it; each row is shown only if the member's own access allows it.

**Response:**

```json
{
  "items": [
    {"kind": "call", "at": "2026-11-06T13:28:29+00:00", "text": "Wants a red Kanchi silk, visiting Saturday",
     "target": {"type": "phone_call", "id": "<uuid>"},
     "detail": {"direction": "inbound", "duration_s": 126, "outcome": "positive", "recorded": false, "simulated": false}}
  ],
  "next_before": "2026-11-06T09:00:00+00:00"
}
```

- **Order:** newest first.
- **Next page:** pass `next_before` as `before`; it is `null` on the last page.
- **Text:** at most 200 characters. Amounts are in paise.
- **No recording URL yet:** calls are not recorded (`recorded` is false); a URL will be added if recording is switched on.

| kind | text | target.type | detail |
|---|---|---|---|
| `call` | the call's short summary (else its outcome or state) | `phone_call` | direction, duration_s, outcome, recorded, simulated |
| `message_in` | what the customer wrote (an enquiry: WhatsApp, e-mail, website) | `enquiry` | channel |
| `arrival` | how they first came (the form's message, else the source) | `lead` | source, how (first, repeat) |
| `message_out` | our message | `outbox_message` | channel, status, category |
| `quote` | "Quote 12" | `quote` or `material_quote` | status, total_paise |
| `visit` | the visit's purpose | `visit` | status, starts_at, outcome |
| `order` | "Order 7" | `order` | state, total_paise |
| `follow_up` | channel and direction, e.g. "whatsapp out" | `lead` | channel, direction |
| `outcome` | the category, else the outcome | `lead` | outcome, category, source, corrected |

**Not included yet:** notes, because there is no notes table. 422 `validation_error` means a bad `lead_id`, `before` or `limit`.
