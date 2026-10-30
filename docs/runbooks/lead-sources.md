# Lead sources and imports: what the operator sets up (job DR / A2, ADR 0107)

Everything below is **off or unset by default**; nothing here is needed for a bulk import from a file, a pasted list, a vCard or a public Google Sheet.

| Door | What it needs | Setting |
|---|---|---|
| Website form, generic webhook (Zapier, n8n) | The registered worker account (the same `SCHEDULER_EMAIL` / `SCHEDULER_PASSWORD` the webhooks use) and `PUBLIC_BASE_URL` so the address shown to the owner is complete. | none new |
| E-mail forwarding from a portal | An inbound mail provider that posts a received mail to a URL. Either one URL per source (`POST /v1/lead-intake/{token}/email`, nothing else to set) or one global address: `LEAD_INBOUND_DOMAIN` (the domain of `leads+TOKEN@domain`, where the provider routes mail to `POST /v1/lead-intake/mail`) and `LEAD_INBOUND_SECRET` (the provider sends it as the header `X-Inbound-Secret`). The provider is not chosen yet. | `LEAD_INBOUND_DOMAIN`, `LEAD_INBOUND_SECRET` |
| E-mail forwarding through Resend (`leads.stack19.com`) | The Resend domain `leads.stack19.com` with receiving on (DKIM TXT and the MX on the `leads` sub-domain only; stack19.com's own mail is untouched), a webhook to `POST /v1/lead-intake/resend` for `email.received` only, the leads key and the webhook's signing secret. The call is checked against the Svix signature; the mail (the event has no body) is fetched with the leads key and read like any forwarded mail. An address that does not exist or is rotated, and a mail that is not a lead, answer 202 `unrecognised` (Resend does not retry); a mail that could not be fetched answers 502 so Resend tries again. | `LEAD_RESEND_API_KEY` (secret `sme-resend-leads-api-key`), `LEAD_RESEND_WEBHOOK_SECRET` (secret `sme-resend-webhook-secret`), `LEAD_INBOUND_DOMAIN=leads.stack19.com` |
| Meta Lead Ads | Meta's app verification, the app secret and a page token with `leads_retrieval`. Until then `META_LEAD_PROVIDER` is `off` (the routes answer 503); `fake` is for development. | `META_LEAD_PROVIDER`, `META_APP_SECRET`, `META_PAGE_TOKEN` (Secret Manager) |
| IndiaMART | The installation's CRM key (existing: `INDIAMART_PROVIDER=real`, `INDIAMART_CRM_KEY`). The owner registers an `indiamart` source (with the consent confirmation) and pulls; the pull goes through the new pipeline. | existing |
| Do-Not-Disturb lookup | A provider of the national register's lookup. None is chosen: with `LEAD_DND_PROVIDER=off` nobody is marked and the preview says `dnd_lookup: not_configured`. | `LEAD_DND_PROVIDER` |
| A private Google Sheet | A Google service account (the owner shares the sheet with its address). Not built: the access endpoint says `service_account: available false`. | `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` (shown to owners; the key is not used yet) |

## Checks before the first real use
1. Forward one real mail of each portal (IndiaMART, JustDial, 99acres, MagicBricks, Housing) to a test source and look at **Unparsed mail**: the parsers were written from the portals' typical mails, not from real ones. Send the real mails to the developer to fix the labels.
2. Open the real-data gate only through `app.operator_open_real_data_gate` as for any workspace; until then a real number is refused row by row.
3. The per-source caps are in the database (`scheduler_lead_intake_live`: 20 rows a call, 60 calls a minute, 2,000 leads a day). Raise them there if a busy site needs more.

## Rotating a secret address
The owner presses "New address" on the source (`POST /lead-sources/{id}/rotate`); the old address stops at once. The operator cannot see an address: only its hash is stored.
