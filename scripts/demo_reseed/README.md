# Demo reseed: Neelambari Silks (demo)

One SQL file that gives the staging workspace named exactly `Neelambari Silks (demo)` a clean, believable set of data for a demo. Synthetic people only, `+00` phone numbers that nobody can dial or message, and nothing is ever sent.

## Run it

```
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/demo_reseed/neelambari_silks.sql
```

Run it as the database operator (`postgres`). It is ONE transaction: if any step or any self-check fails, everything is rolled back. It finds the workspace by NAME (it stops unless exactly one workspace has that name) and writes only rows of that workspace. It takes the workspace's owner (else an admin) from `memberships` as the author of the rows and of the audit trail.

Run it again any time: on the same day it changes nothing (the check proves it). On another day it renews what goes stale (below). To check it on a local database first: `python3 scripts/demo_reseed/check_local.py` (never commits).

## Nothing is deleted

The database refuses to delete calls, messages, quotes, orders, visits, requests, prospects and catalogue items (triggers, also for the operator), and the repo has no operator pattern that switches those triggers off. So the cleanup renames, archives, rejects, cancels or marks handled. Nothing is switched off with `disable trigger`.

## What the cleanup does (this workspace only)

A "leftover" is any row whose visible text matches (case-insensitive) `smoke`, `click-through`, `df click`, `synthetic`, a word starting `test`, `lorem`, `example:`, `test buyer`, the word `DF`, or a word starting `demo`.

| Table | Filter | Action |
|---|---|---|
| `contacts`, `companies` | name / job title / website / industry is a leftover | renamed to a plain real-sounding name (so calls and messages that point at them read well); a leftover e-mail is cleared |
| `leads`, `enquiries` | the lead's name, source, reason, profile text or an enquiry is a leftover | archived (`archived_at`); the contact and company are archived too when no live lead uses them |
| `quotes` | a draft (any, except today's slot), or a quote above Rs 1,00,000, or one of a leftover lead, or a leftover line | draft: rejected (`other`); approved: its open order is cancelled first, then the quote is withdrawn (`entered_in_error`); an order that cannot be cancelled keeps its quote and a warning is printed |
| `outbox_messages` | status `needs_approval` (any, except today's slot), or `queued` and a leftover | `blocked`, reason `owner_rejected` (nothing can be sent). Other queued messages are not touched; a warning counts them |
| `call_requests` | status `requested` (except today's slot) | `rejected` |
| `prospects` | status `needs_owner` (except today's slot) | `skipped` |
| `followup_drafts` | status `draft` | `discarded` |
| `campaigns` | status `draft` | `cancelled` |
| `tasks` | `planned`, `needs_answer`, `paused`; or running/approved and a leftover | `cancelled` |
| `outreach_batches` | `planned`, `paused`; or running/approved and a leftover | `cancelled` |
| `phone_calls` | a hand-over or a visit request nobody handled (7 days) | marked handled. A call whose summary is a leftover gets a plain `summary_corrected` (detail view). A call still running from an earlier day is closed as failed |
| `store_visits` | a leftover, or a visit the assistant proposed that nobody confirmed, or an open visit of an earlier day of this script | `cancelled` |
| `catalogue_items`, `item_types` | everything that is not one of the 18 products | switched off (`active = false`) |

Never touched: the workspace, users and memberships, billing and pricing rows (price lists, quote and order policies, plans, wallets), call settings, voice settings, products, other workspaces.

What the database does not allow to change, and so stays: the old calls themselves (their summary text), old outbox messages, old quotes and orders as records (they are rejected / withdrawn / cancelled, but a rejected "Rs 19,44,600" quote still exists in the quote history), old catalogue items (switched off, still listed as drafts).

## What it creates (deterministic ids: `md5('stack19.demo-reseed.neelambari:' || key)`)

* Catalogue: the owner's 18 products in 4 categories (a choice field `category` on the catalogue item, because the catalogue table has no category column). Stock is the owner's number, or `quantity` NULL = not counted (the app asks). Prices: only a placeholder price band (the owner sent no prices). The catalogue has no field that says "draft price": nothing in the app marks the band as unconfirmed. All 18 are drafts (`active = false`): an item can only be on with a photo, and a photo is a stored file this script cannot invent.
* 15 customers (company, contact, lead, profile, first enquiry) from three sources, `Instagram`, `indiamart` (shown as IndiaMART), `Walk-in`, with source costs (Instagram Rs 65, IndiaMART Rs 55, Walk-in nothing per lead). Instagram and Walk-in are free text in `leads.source`; the repo's source tags have no word for them.
* Leads in six stages (what the Leads page derives): new 3, contacted 1, visit booked 4, quote 3, won 2, lost 2.
* Six WhatsApp chats (2 need you, 2 assistant, 2 done) with earlier answers written as `sent` in the past, and ONE reply waiting for the owner (`needs_approval`) with up to 3 photo rows taken from the workspace's own catalogue photos.
* Quotes (manual prices, built by the database's own function and checked against the real quote engine): Rs 24,500 (draft, to approve), Rs 48,000 (sent), Rs 15,400 (approved), Rs 31,800 and Rs 27,500 (accepted), Rs 56,000 (rejected); their orders.
* Visits: 5 older ones for the funnel (2 bought, 1 no-show) and 4 today at four times (1 done, 1 confirmed, 2 booked).
* Calls: 9 (4 completed, 1 transferred, 1 no answer, 1 rejected, 1 spam, inbound and outbound, over 6 days; 3 with a transcript) and 1 live call.
* Reports: a finished follow-up plan with its calls, answered calls and 6 booked visits, so the funnel, sources and cost per visit are all above zero.
* Needs you: a quote to approve, a callback request, a waiting reply (Today counts these 3) and one new prospect (the menu adds prospects: 4).
* One running assistant job ("Following up 5 saree enquiries"): a Lead Desk task with nobody left to contact.

## Safety

* No message the sender can pick up: the self-check fails the run if any outbox row is `queued` or scheduled, or if more than one waits for approval. Earlier answers are inserted `queued` and changed to `sent` inside the same transaction (the database only lets a message start queued), so no other session ever sees them queued.
* Every contact number is `+00 90003 xxxxx`. The self-check fails the run otherwise.
* The calls are final rows. The live call is `in_progress` with a fresh heartbeat; the scheduler's orphan closer (`phone_calls_close_orphans`) ends it after about 4 minutes, as it would any silent call. Run the file just before the demo.
* The running task has no `task_contacts` rows: the runner and the dialer only act on waiting people of a task.

## Re-running

"Slots" (one set a day, the day is the India date): the draft quote, the callback request, the prospect, the waiting reply, the live call and today's visits. Same day: kept. If the owner decided one, or the day changed, a new one is made and the old open ones are closed. Everything else (people, history, older visits, quotes, calls) is made once and kept as it is.

## Not covered

* Photos: no file is uploaded. The waiting reply uses the workspace's existing catalogue photo rows (which show the old trial pictures).
* The text of an outcome sentence ("Quote of Rs 24,500 for 3 sarees sent") is derived by the API from closed words, never stored; the quote line is in the call summary.
