# The assistant does everything the website can do: the coverage list (14 Nov 2026)

Owner order (16:15 CET): list every owner action on every page, mark each with ✓ / ✗ for "the assistant can do it", then build every ✗. Safety stays: a small setting applies at once with **Undo**; calls, customer messages, money, deletes and bulk changes show a **plan card and wait for the yes**; some things stay on a screen on purpose.

## Two different questions (read this first)

1. **Is there a tool?** Every user-facing route of the API is a tool or a deliberate screen-only door (`docs/assistant-tools-coverage.md`, generated from the live routes: 539 tools of 616 operations, 91.5 % of what is allowed). On this question almost every row below is ✓.
2. **Can the owner reach the tool by saying it** in the composer, in a chat or in Talk live? Today only these requests are routed to a plan card: calling hours, auto-reply on/off, pause or resume a lead source, add one lead, remove the example data, the setup helpers (e-mail forward, website form, team invite, voice and language, follow-up rules, Google Sheet, IndiaMART), connecting a source with the owner's own key; plus the task planner (call or message people, one named person), Lead Finder, files dropped in the chat (leads, prices, stock, enquiries) and the read tools of the records path. **Every other write tool has no request path.** That is the real gap: the column "By voice or chat" below says ✗ for those.

The generic fix (slice G, below) is ONE router for writes: the owner's words -> a checked choice of one write tool and its arguments from the tool catalogue -> a plan card by sensitivity (small setting: applied now with Undo; sensitive: card and yes). It replaces the eight hand-written actions and covers the rest at once.

Legend: **Tool** = exists as an assistant tool. **By voice or chat** = reachable today from the composer, chat and Talk live. ✓ done, ✗ build (slice in the last column), ⛔ stays on a screen on purpose.

## Pages and actions

| Page | Owner action | Tool(s) | By voice or chat | Slice |
|---|---|---|---|---|
| Today | read the numbers, what needs me | `today.*`, `nav-counts`, `ai-usage.*` | ✓ (read tools) | |
| Today | approve / skip an item in Needs you | `outbox.approve_message`, `followup-drafts.*`, `quotes.*`, `call-requests.*` | ✗ | G |
| Leads / Lead Desk | list, search, open one lead | `leads.list_leads`, `leads.search_leads`, `leads.get_leads` | ✓ | |
| Leads | add one person | `leads.create_leads`, `contacts.create_contacts` | ✓ (router `add_lead`; now on for every workspace of the owner; the number said in the turn before counts) | |
| Leads | edit a lead (name, city, status, owner, notes) | `leads.update_leads`, `leads.fix_profile`, `contacts.update_contacts` | ✗ | G |
| Leads | labels, touches, mark seen | `leads.create_lead_label`, `leads.record_touch`, `leads.mark_seen` | ✗ | G |
| Leads | archive / restore | `leads.archive_leads`, `leads.restore_leads` | ✗ (sensitive: card and yes) | G |
| Leads | import a list (PDF, photo, Excel, Word, CSV, handwriting) | `leads.preview_lead_import`, `leads.commit_lead_import` | ✓ for readable files; ✗ editable preview with unsure cells, handwriting, 90-day original | F (file import v2) |
| Contacts | record consent, suppress, lift | `contacts.record_consent`, `contacts.suppress`, `contacts.lift_suppression` | ✓ through the plan card ("ask first", owner confirms); ✗ by plain words | G |
| Calls | call one named person | `tasks.plan`, `tasks.approve`, `calls.place_call` | ✓ (14 Nov: any-script name match, ask for the number and save, real Plivo call on a sandbox-list number) | |
| Calls | call a group (new leads, old leads, a list) | `tasks.*` | ✓ (plan card, strict consent, per-day limit; **simulated** dialer until `TASKS_DIALER=plivo` is set: owner decision) | |
| Calls | list calls, open a call, transcript | `calls.list_calls`, `calls.get_call` | ✓ | |
| Calls | hang up, mark handled, correct a summary, whisper | `calls.hang_up`, `calls.mark_handled`, `calls.correct_call`, `calls.whisper` | ✗ | G |
| Calls | test call to my own phone | `ai-assistant.test_call`, `calls.place_call` | ✗ | G |
| Calls | allow live take-over | `calls.take-over-setting` | ⛔ (only the Owner, on a screen) | |
| Chats / WhatsApp | read a chat, draft a reply | `leads.draft_message`, `whatsapp.*` | ✓ (draft), ✗ (send: card and yes) | G |
| Chats | send a message to one person | `outbox.*`, `leads.create_draft` | ✗ | G (sensitive) |
| Outbox | approve, edit, reject a message | `outbox.approve_message`, `outbox.edit_message`, `outbox.reject_message` | ✗ | G |
| Campaigns | create, edit, start, pause a campaign | `campaigns.*`, `call-settings.put_campaign` | ✗ | G (sensitive) |
| Follow-up rules | switch rules, change timing | `outreach.*`, `lead-playbook.*` | ✓ (setup helper `followup_rules`), ✗ for the rest | G |
| Catalogue | list items, stock, low stock | `catalogue.list_items`, `catalogue.low_stock` | ✓ | |
| Catalogue | edit an item, price or stock | `catalogue.put_item`, `catalogue.put_quantity` | ✓ from a file; ✗ by plain words ("set Kanchi 24,500") | G |
| Prices | import a price list (PDF, Excel, photo) | `price-lists.preview_price_list`, `price-lists.commit_price_list` | ✓ readable files; ✗ editable preview | F |
| Quotes / orders / dues | create or send a quote, close an order, record a payment | `quotes.*`, `orders.*`, `dues.*`, `payment-links.*` | ✗ | G (money: card and yes) |
| Visits / calendar | list today's visits, free slots | `visits.get_today`, `visits.get_slots` | ✓ | |
| Visits / calendar | book, move, cancel, confirm, complete a visit | `visits.book_visit`, `visits.change_visit`, `visits.cancel_visit`, `visits.confirm_visit` | ✗ | G |
| Visits / calendar | connect Google Calendar | `integrations.google_calendar_settings`, `integrations.google_calendar_status` | ⛔ (Google's consent screen) | |
| Lead Finder | find new businesses, approve a search | `lead-finder.plan`, `lead-finder.approve` | ✓ | |
| Lead sources | pause / resume / rotate a source, connect with a key | `lead-sources.*` | ✓ pause, resume, key; ✗ rotate, create | G |
| Settings: voice, greeting, hours | calling hours | `call-settings.put_settings` | ✓ (`calling_hours`) | |
| Settings: voice, greeting, hours | opening line, voice, language, pronunciation, speaking style | `ai-assistant.put_opening`, `ai-assistant.*`, `speaking-style.*`, `how-assistant-speaks.put_how_assistant_speaks` | ✓ voice and language (setup helper); ✗ opening line, words, style | G (small: applied with Undo) |
| Settings | auto-reply on/off | `ai-assistant.put_auto_reply` | ✓ | |
| Settings: Rules | per-day call limit, spending cap, quiet hours | `tasks.set_call_limit`, `outbox.put_settings` | ✗ | G (small: Undo; the call limit has no authenticator in the shop app) |
| Settings | business profile, logo, GST details | `workspace.patch_business` | ✗ | G |
| Settings | team: invite, change a role, remove | `invitations.*`, `members.*` | ✓ invite (setup helper); ✗ role, remove | G (sensitive: Owner only) |
| Phone numbers | see the line and the KYC state | `phone-kyc.status`, `phone-kyc.options` | ✗ | G |
| Phone numbers | submit KYC details | `phone-kyc.submit` | ✗ | G (sensitive) |
| Phone numbers | rent or release a real number | (not a tool) | ⛔ stop line: no real number rental without the owner's OK | |
| Billing | balance, usage, invoices | `billing.balance`, `billing.get_usage`, `billing.list_invoices` | ✓ | |
| Billing | top up, change plan, cancel | (screen only) | ⛔ by design; the assistant answers with the Billing screen's link and the amount (slice B) | B |
| Reports | ask a question about sales, calls, leads | `reports.*`, `ai-team.*`, business path | ✓ | |
| How it talks to you | per-person voice, style, address, words, speed | `how-assistant-speaks.*` (workspace) and the per-person profile of PR #629 | ✗ per-person by words | G |
| Privacy / data | export my data, erase a person | `exports.*`, erasure routes | ✗ export; ⛔ erase (a person decides) | G for export |
| Example data | remove the example data | `example-data.*` | ✓ | |

## Build order (each slice: one PR, a plan card or Undo, tests, a line in this table)

* **F, file import v2** (owner order: 3 before 4). Editable preview, destinations Leads / Catalogue / Prices, consent source for leads, handwriting, original kept 90 days. Contract `docs/contracts/file-import.md`.
* **G, one generic write router.** The router (`app/assistant_work/router.py`) gets the whole write catalogue, grouped (leads, calls, chats and outbox, campaigns, catalogue and prices, visits, settings, team, phone numbers), picks ONE tool and its arguments from the owner's words and the turn before, and every argument is checked against the route's own schema and against the words. Level `write` with an Undo (snapshot or inverse): applied now, "Done · Undo". Level `sensitive`: plan card, explicit yes, Owner only where the tool says so. Same router in the composer, the chat and Talk live (the voice socket already uses the conversation turn).
* **B, the top-up answer.** "Top up" in a conversation answers with the balance line and the Billing link; nothing is charged by the assistant (live billing stays off).

## What C2 builds for these

Plan-card variants for G (a one-line "Do it" card for a setting with the Undo chip; the sensitive card with the second yes); the Undo chip on the chat bubble; the import preview table and the destination chooser (F). Each row above says which.
