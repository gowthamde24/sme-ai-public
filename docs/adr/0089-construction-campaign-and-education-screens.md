# ADR 0089: the construction, campaign and education screens, and the polish (jobs CO, CQ, CS, CU; night run C2)

Status: **BUILT (night run C2, 2026-10-15), for the owner's review.** The web lane only: **no backend, database or API change** (the screens read the APIs of ADRs 0085, 0086, 0087 and 0088). Builds on ADR 0084 (packs and modules; reminder campaigns; children's data), ADR 0085 (the building-materials core), ADR 0086 (the shared ledger and the campaign engine), ADR 0087 (the education core) and the blueprint's sections 5 and 6. Job CU (the polish and the reports screens) is at the end.

## Rules every screen of the night obeys

1. **Modules, not pack ids.** A page, a card, a menu item or a word changes because a MODULE is on (`materials`, `deliveries`, `sites`, `dues`, `fees`, `programmes`, `campaigns`), never because of a business type's name. The words come from the pack files and the string store (`name@materials` overrides `name` when the module is on).
2. **Nothing is sent by a screen.** A quote, a receipt and a trip's delivery note are printed or copied for a person to send. A campaign is approved once by the Owner, with the second factor, after reading the samples; approving sends nothing by itself.
3. **Every refusal is a sentence of ours,** chosen by the API's closed status and code. The API's text is never shown.
4. **Every money action is a confirmation that shows the amount in words;** a retry is the same id; a mistake is voided, never edited.
5. **A child is the minimum** (job CR): a first name or initials, a placement, an admission number. The forms have no other box; the checks run again on the server before the request; the preview, the lists and the messages name the parent, never the child.

## What was built

### CO: construction screens
Products (area and weight units, specs, photos), customers and sites, the quote builder over the quote engine's calculator (area to quantity, transport and rounding rules shown with their trace), orders and deliveries (a trips board, the trip form, proof of delivery from the phone, the delivery note to print), dues (ageing, statements, payments, receipts, the credit limit), and Today cards (trips today, quotes waiting, what falls due this week). The shared saree words are gone from these screens for a business with the module `materials`.

### CQ: campaigns and the call list
The list, a form (kind by module, merge fields from buttons, steps in days from each person's own date, a call plan for a money reminder), the people (from the ledger for a range, or from a pasted or uploaded list read line by line), the check and approve tab (the first, the longest, the highest amount and three at random, each as the person will read it; the Owner approves once with the second factor and the hash of what was shown, so a campaign that changed since is refused), pause, resume and cancel, the results (sent, delivered, read, replied, paid after a reminder, blocked or skipped with the reason in words) and the call list (one tap rings the shop's phone first and then the customer's; the outcome is paid, promised a date, call later, wrong number or stop).

### CS: education screens
The institution and its programmes, the students (a list, one student, add and change, mark as left, erase one child on request, the students file through the same guarded import with a mapping step), fee plans (heads, instalments with due dates, a late-fee rule; a held plan is read only and is copied), the student's fee account (give a plan, take a payment with its receipt, a concession by amount or percent, an adjustment, void; print or copy a receipt), the collection screen ("pending", never a harsher word), the pending list, late fees (looked at, then posted by the Owner or an Admin with the second factor), the admissions board (enquiry, campus visit, application, admitted, lost; admit makes the student and gives the plan in one go), announcements (event, exam, holiday campaigns whose audience is chosen from the students: one message per parent), a fee reminder campaign built from the ledger with the students' parents as ONE person each, Today cards (fees collected today, reminders running, campus visits today) and the first-run steps (the institution, the students file, a fee plan, the first approved campaign).

### CU: the polish and the reports screens
* **Reports per business type.** `/report` keeps the weekly page; below it the business type's own reports are listed from the one reports API (`GET /reports/catalogue`, the codes the modules allow) and each opens at `/report/[code]` with a start and end (India days) or one day. A figure, a column or a bar is drawn by its TYPE; the words come from `rep.*` strings by key (the units, statuses and methods fall back on words other screens already have; a code with no words is a plain name, never an underscore). A business without a catalogue (a school) has no "sarees sent most" card, and a builder's says "products". The saree shop's page is unchanged (its catalogue lists only the weekly report).
* **The phone's bottom bar is a pack setting.** A business type whose core tab is the quotes keeps today's five tabs (Today, Leads, Quotes, Visits, Office); one whose core tab is another (Orders & deliveries, Fees) gets the blueprint's four (Today, Inbox, its core tab, Contacts) and More. The pack files carry no bar field yet (adding one changes their hash, which the database copies: a pack-version job), so the core tab decides.
* **Words by module for a translation function** (`withModuleT`): Today's "What can Agent OWL do?" panel and chips and the help guides say "products" to a builder and talk about parents and enquiries to a school, and say that a child's record is kept out of Agent OWL's reach. Only what the assistant can really do is claimed.
* **String completeness is a test** (`i18n/used-keys.test.ts`): every key these jobs name in a screen exists in four languages, and every family a key is built from has members.
* **Budgets and speed.** `npm run audit:route-js` passes on all 103 routes; `make visual` and `make perf` were run under the heavy-test lock (see the report for the numbers).

## Decisions taken

1. **Separate routes instead of branches in saree routes.** The materials product screens live on `/materials*` and the saree `/catalogue*` pages redirect there for a business with the module, so a saree workspace never downloads them (the route-JS budget counts a first visit). The same holds for every new route.
2. **Budgets.** The four materials routes are set to 190,000 B (measured 187,805) and the seven campaign and announcement routes to 190,000 B (measured 187,920): they are new routes of new features, not a raise of an existing ceiling. Today stays at 201,392 B of 204,000 and the landing page at 149,069 B of 156,000. The school's own routes are all under the 186,000 B default (the largest 182,250). A trim job should share the photo code of the two product editors and the people-list reader of the campaign.
3. **The amount in words is English in every language.** The words of an amount ("Rupees Twelve Thousand Only") come from one table; the other languages show the figure and the English words until a reviewer supplies tables.
4. **No "send on WhatsApp" link.** A guard test forbids `wa.me` outside the number rule; the quote and the receipt have "Copy as a message" and a print button instead.
5. **Phone numbers are never shown.** The call list, the audience and the samples show a name; the bridge call is made by the API, which holds the number.
6. **A guardian is chosen from the 100 newest contacts** because the API's contact list has no search. A new parent arrives with an admission enquiry (name and WhatsApp number) or the students file; a brother or sister is added from the student's page.
7. **Percent and amount concessions** share the entry sheet with the payment and the adjustment; "late fee" is not a reason a person may give for an adjustment (the API refuses it).
8. **The report screens read the one shape** (`GET /reports/run/{code}`: figures, typed tables, series). A column is drawn by its type, its words come from `rep.*` strings by key, and a key with no words is drawn as a plain name, never as a code.
9. **`@contracts/education` and `@contracts/reports`** are path aliases to the committed contract files (the barrel `packages/contracts/index.ts` does not re-export them because their type names collide).
10. **Strings:** about 1,100 keys were added in four languages. The Telugu, Hindi and Kannada words are machine drafts marked `draft`; money, approval and consent statements and brand names are human-only English until a native reader reviews them.

## Not decided here

* A search for contacts by name (a backend change). A per-child message (refused by design in ADR 0087). Online payment links, attendance, marks, a timetable, student photographs or ID cards (out of scope for the education pack). An export of the students (none exists).
* The wording of the three Indian languages for the education and construction screens waits for a native reader; the packs stay in `preview` until a real owner of that kind of business has used them.
