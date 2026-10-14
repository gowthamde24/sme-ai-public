# Personal data inventory (job BH)

What personal data the system stores, why, for how long, who processes it, where, and how it is deleted. Built from the migrations, the ADRs (0001, 0003, 0005, 0008, 0013, 0014, 0015, 0017, 0020, 0062, 0065, 0066, 0069, 0071), the runbooks and `services/`. **Engineering inventory, not legal advice.** It is the source of the Privacy Policy text (`apps/web/lib/legal/privacy-text.ts`); when the code changes what is stored, change this file and that text, and bump `LEGAL_VERSION`.

State today (2026-10-12): everything runs on a developer machine with invented data; **nothing is deployed**; no real-data gate is open; the only outgoing channel is a local fake (no real WhatsApp, e-mail or SMS adapter exists); the models are scripted, local or a hosted free tier on invented data; no speech provider is switched on. The "where" and "who" columns say what is *planned* (ADR 0015) and what the owner must confirm.

## 1. Roles
* **Account holders** (an Owner, Admin, Sales or Viewer who signs up): we are the data fiduciary (DPDP) / controller (GDPR).
* **A business's customers and leads** (people and companies the business enters): the business is the data fiduciary; we process on its behalf (data processor). Consent for contact is the business's duty; the product records it (ADR 0005).

## 2. What is stored
| Group | Where (table.column) | Personal data | Why | Erasure |
|---|---|---|---|---|
| Sign-in account | `auth.users` (Supabase): e-mail, password hash, MFA factors (authenticator secret), sessions (IP, user agent, times) | e-mail, hashed password, TOTP secret, IP, browser | sign in, security | account deletion by request (the "account deletion vs last owner" item in `pre-pilot-checklist.md` is open: manual until built); `public.users` rows go with it (cascade) |
| Profile | `public.users.display_name` | name | show who did what | with the account |
| Terms acceptance | `public.terms_acceptances` (`user_id`, `terms_version`, time) and `integrations.policy_acceptances` (kind, version, time, via `signup`, `setup` or `prompt`) | version + time | record the consent given at sign-up (an e-mail sign-up) or at the setup (a Google or Facebook account) | with the account |
| Social sign-in identity | `auth.identities` (Supabase): the provider, the provider's user id and the profile the provider sends (e-mail, whether it is verified, and usually a name and a picture address) | e-mail, provider profile | sign in with Google or Facebook (off until the owner configures a provider) | with the account (Supabase); the API reads only the verified flag |
| Business | `tenants.name`, `memberships` (user, role), `store_settings`, `outbox_settings`, `tenant_agent_settings`, `scheduler_settings` | business name (a sole proprietor's name can be a person's), roles | run the workspace | tenant-scope erasure leaves company identity alone by design (ADR 0014 d.4); the business is not a person |
| Contacts (customers) | `contacts`: `full_name`, `email`, `phone`, `job_title`; consent columns and `suppressed_at`, `suppression_reason` | name, e-mail, phone, job title | the business's sales work | `erasure` contact / tenant scope: NULL or tombstone `erased:1`, row kept, archived |
| Consent ledger | `consent_events` (channel, status, basis, `evidence_ref`, time, recorded_by) | consent history, a reference to evidence | prove consent, honour opt-outs | structure kept, `evidence_ref` tombstoned |
| Companies | `companies`: `name`, `website`, `city`, `region`, `tags` | can name a sole proprietor | CRM | company-scope erasure |
| Leads, opportunities | `leads.source`, `disqualified_reason`, `opportunities.title`, `lost_reason` | free text that can name people | CRM | swept for exact e-mail/phone; names go to manual review |
| Evidence, claims | `evidence.url`, `reference`, `snippet`, `claims.value` | free text, URLs | provenance of research | tombstoned by scope |
| Enquiries, requirements | `enquiries.subject`, `body` (up to 6,000 chars), `retain_until` (no rule yet); `requirement_fields.value_text` (delivery city) | free text, location | quoting | swept / erased by scope |
| Quotes, orders | amounts, dates, ids (no contact fields; the lead is an id) | transaction data | business records | kept; PII-free (checklist: counsel to confirm) |
| Store visits | `store_visits`: date/time, party size, `purpose`, `note`, `cancel_reason`; `visit_reminders` | free text naming the customer | book and remind | swept / erased by scope |
| Call requests | `call_requests.reason`, `script_draft`, `decision_note` | free text | owner-approved calls | swept / erased by scope |
| Messages | `outbox_messages.body`, `gloss_en`, status, who made/approved; `outbox_events`; `outbox_message_media` | message text to a customer, their phone via the contact | send WhatsApp under policy | `body`/`gloss_en` swept and erased by scope; rows are never deleted |
| Follow-ups | `followup_drafts`, `lead_touches`, `question_drafts` | draft text, touch history | follow-up | kept PII-free after erasure (checklist) |
| Chats with Agent OWL | `assistant_conversations`, `assistant_messages.body`, `assistant_reply_drafts.body`/`gloss_en` | what the owner typed or said (as text) and the answers; can name customers | the assistant | exact e-mail/phone swept; names to manual review; tenant scope erases; **no retention rule** (checklist item) |
| Voice | not stored | the recording exists only in memory for the request (`/assistant/voice`); only the transcript is kept, as a chat message | speech to text | n/a |
| Custom field values | `public.custom_field_values` (`value_text`, `value_number`, `value_date`, `value_bool`, `value_choices`) on a contact or a catalogue item; definitions in `custom_field_defs` | whatever the business enters in a field it defined; a field marked `personal` holds personal data by design, a class-`none` text cannot hold a phone number or an e-mail (the database refuses it) | the business's own columns (site area, customer type, credit days) | deleted with an erased contact; wiped and swept by the tenant scope (registry rows); never read by a model; not exported (no contact export exists) |
| Sites (job CN) | `public.customer_sites`: `name`, `address_line`, `city`, `pin`, `map_lat`, `map_lng`, `access_notes`, `distance_km`, `site_contact_id` | a place where a person lives or works (a private site can be a home); free text refuses phone numbers and e-mail addresses | where a truck goes | wiped with the company; swept by the tenant scope; never read by a model |
| Trips and proof of delivery (job CN) | `public.delivery_trips`: `vehicle_no`, `driver_name`, `driver_phone`; `delivery_proofs`: `received_by`, the photo in the private bucket `pod-<tenant>` | a driver's name and phone, a vehicle number, the name of who received the goods; the photo can show people | deliveries, the delivery note, proof | vehicle, driver and receiver are cleared by the erasure functions and swept; removing the photo files is an operator step (checklist); never read by a model |
| Receivables ledger (job CN, generalised by job CP) | `public.ledger_accounts` (one per party: a company or a contact), `public.ledger_entries`: kind (charge, payment, adjustment, concession), amount, dates, the owner's invoice number or a strict-pattern label, method, reason code, **receipt number**; `customer_credit_limits` | transaction data; the party is a company or a contact id, never a name; a label cannot hold a name or a number (the database refuses it) | receivables, ageing, receipts, the credit warning, a fee ledger (education) | kept as accounting records (never deleted, only voided); erasing the party anonymises them; a viewer cannot read them; a model never reads them |
| Reminder campaigns (job CP) | `public.campaigns` (`name`, `message_text`: the owner's words, can name a person), `campaign_recipients` (a contact, a lead, a due date, an amount from the list or ledger, a strict-pattern label, a row hash, why they were closed), `campaign_steps` (when, state, a closed reason, the outbox message id) | the owner's words and a list of people the business already deals with, with what each owes; the messages themselves are outbox messages | reminders about a payment, a delivery, a fee, an event, an exam or a holiday | the name and text are erased by the tenant scope and swept; the rows stay with the contact (the contact's own erasure anonymises the messages); a viewer cannot read them; a model never reads them |
| Call list (job CP) | `public.call_list_items` (a person, a campaign, the approved call request, the outcome, a promised date) and the call request's reason and script (outbox rules) | who to call and what they said (paid, promised, call later, wrong number, stop); no number is stored here or shown | staff call back about what is unpaid | the call request's text is erased like any call request; a viewer cannot read it |
| Material quotes (job CN) | `public.material_quotes`, `material_quote_lines`, `material_quote_policies`: the request and result text, figures, the owner's rules | the site name is an id; no contact fields | the quote and why each number is what it is | kept as business records |
| Pack, example data | `packs.workspace_pack` (which business type a workspace runs), `packs.example_batches`, `packs.example_rows` (ids and a content hash of the labelled sample) | none | module switches; remove the sample without touching real rows | with the workspace |
| Catalogue | `catalogue_items`, `catalogue_photos` + Storage bucket per business | product data, photos the business uploads (no people intended) | catalogue | rows soft-removed; files stay in Storage (local note) |
| Suppression keys | `suppression.contact_keys`, `key_events` | HMAC (keyed hash) of phone/e-mail | never contact someone who opted out, also after erasure | **kept on purpose** after erasure (ADR 0020; DPDP review item) |
| Audit | `audit_events` (actor user id, table, row id, changed columns by NAME; values only for non-PII columns) | user ids | accountability | immutable; company-scope erasure removes four company identity keys |
| AI usage | `agent_runs`, `agent_run_steps`, `agent_cost_reservations` | user id, tool calls and results (ids, labels), cost | cost caps, audit | tenant scope per registry |
| Erasure log | `erasure_requests` | ids, counts, who/when; never values | prove erasure | kept |
| Exports | `data_exports` (kind, format, row count, hash, who, when); the file is not stored | none | audit of downloads | n/a (the file is the user's) |
| Scheduler | `scheduler_runs`, `visit_reminders` | ids, times | reminders | retention not decided (checklist) |
| Browser | cookies `sb-<project>-auth-token` (+ chunks, `-code-verifier`), `sme_lang`, `sme_theme`, `sme_consent`; localStorage `sme_menu_collapsed`, `sme_office_view`, `sme.contact.keepRecord`, `sme-ask-autoplay`, `sme-ask-voice-notice` | session token; preferences | sign in, preferences | the person's browser |
| In memory | sign-up rate limiter (IP, one hour, capped) | IP | stop abuse | restart |

## 3. Retention (as built)
* No automatic deletion anywhere. Business data stays until an Owner erases it. Not decided yet: enquiry text (`retain_until` hook), chats, scheduler rows, audit retention (all in `pre-pilot-checklist.md`).
* Backups: 7 days on Supabase Pro daily backups (ADR 0014); every erasure newer than a restored backup is repeated.
* Recordings: none. Exports: outside the system.

## 4. Who processes it (planned unless stated)
| Processor | What | Region | Status |
|---|---|---|---|
| Supabase | Postgres, Auth, Storage | Mumbai `ap-south-1` recommended (ADR 0015) | local stack only today; confirm region and DPA before launch |
| Web + API host | Cloud Run `asia-south1` (Mumbai) recommended (ADR 0015) | India | not deployed |
| Model providers | Anthropic (adapter exists, never run live), or a hosted free tier (Groq, Cerebras, OpenRouter; allow-listed; invented data only, ADR 0065) | provider's | **owner must name, read retention and training terms, decide region** (checklist rows 136, 146) |
| Speech providers | Sarvam, Bhashini, Google Cloud, or AI4Bharat models behind an address (ADR 0071); off by default; none signed up | provider's | owner decides; Sarvam keeps data indefinitely unless zero retention is set |
| E-mail (SMTP) | sign-up confirmation, security mail | not chosen | T012 |
| Meta / WhatsApp | only when a business connects its own number; no adapter exists (`OUTBOX_ADAPTER` accepts only `fake`) | Meta | future, needs the owner's written approval |

What reaches a model: the owner's question and the records the tools return (company names, message text, amounts). v1 passes **no contact fields** (names, phones, e-mails) by design (ADR 0013 d.11), but company names and free text can contain personal data (checklist: DPDP/cross-border review before any real data reaches a prompt).

## 5. How deletion works (existing functions)
* `request_erasure` (Owner/Admin) -> `execute_erasure` (Owner; dry run available) -> `cancel_erasure`. Scopes: `contact`, `company`, `tenant` (24 h cancel window). Web: Settings, Privacy (`apps/web/app/app/tenants/[tenantId]/privacy`). Rows are anonymised in place (NULL / `erased:1` / `erased-1`), never deleted; exact e-mail and phone are swept out of every registered free-text column; names are matched by whole-field equality only and the rest goes to a "needs manual review" list (ids only). The consent ledger's structure, suppression keys, labels, counts and the erasure log stay.
* Limits stated to the user: downloaded exports; backups for 7 days; a name inside free text; non-ASCII numerals in phone numbers are not swept.
* Account deletion (the sign-in account itself) has no self-service function yet.

## 6. Gaps found while writing this (for the owner and Claude 1)
1. **Acceptance record is one version string** (`terms_acceptances.terms_version`) for Terms and Privacy together, one row per user (`on conflict do nothing`): there is no re-acceptance flow when a new version is published, and no per-document version. Needed before the texts change after launch.
2. No self-service **account deletion** and no data-**access** download for the account holder.
3. No retention rule for chats, enquiries, scheduler rows, audit rows.
4. Landing FAQ says "Nothing is sent automatically" (faq.1.a); since AT/AY the outbox can send WhatsApp automatically under policy once a real adapter exists. True today (fake adapter only), but must change before a real adapter ships.
5. The owner must name the model, speech, e-mail and hosting providers and confirm regions; the policy has `[CONFIRM ...]` marks for each.
