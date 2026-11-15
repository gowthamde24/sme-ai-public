# Product audit, page by page (C2 leads, C1 for data/API). Version 1, 14 Nov 2026

Owner's brief: make Stack19 the best product in its category. For every page: what is the owner trying to do, what is the fastest path, what is clutter, duplicated, confusing or internal. Benchmarks in mind: Rosie / Goodcall (owner simplicity), Retell / Bolna / Ringg (call logs, live monitoring), WhatsApp Business (chat feel), Linear / Stripe (polish, speed, keyboard). Rules I hold to: plain words, no internal terms, every number appears once, every empty state shows its next step, advanced things behind "More", skeletons not spinners, light / dark / phone each checked. I ask the owner only before removing something that touches money, consent, legal or a feature they asked for.

How to read it: **KEEP** works, **CHANGE** do it, **REMOVE** goes, **ADD** is missing. Status: DONE (in a merged or open PR, named) / NEXT (queued in this order) / ASK (needs the owner).

Pictures: BEFORE (cream theme, 14 Nov 20:40 CET, staging, demo owner): `~/Desktop/stack19-jobs/audit/before/<page>-<desktop|phone>-<light|dark>.png`. AFTER pictures are made after the deploy of each slice into `~/Desktop/stack19-jobs/audit/after/` (the same names). This is v1: Today, Leads, Campaigns, Catalogue, Phone number and Billing are examined in detail from the pictures; Calls, Chats, Reports, My assistant, Settings, onboarding, the phone layout and the staff console have a first pass from earlier review rounds and are the next audit slices.

## Across all pages
- **Light theme too sepia (owner).** DONE #668: page #fafafa, white cards with a 1px #ececec edge, faint #e5e5e5 dots, cool-grey text; tokens only (app, onboarding, staff console, phone, address-bar colour, offline page). Dark theme, dark band and orange accent unchanged.
- **One tab row per page** is the rule, but Leads and Campaigns still carry a long row of sub-pages. NEXT: sub-pages that are rarely used go behind "More".
- **Counts that disagree.** The menu badge on Leads says 68, the page says "All 50". Two different counts under one word. NEXT: the menu badge counts what is new (and says so on hover); the page counts what it lists.
- **Error shown as content.** Campaigns prints "Campaigns are not available right now. Try again in a minute." as a body paragraph. DONE (15 Nov): one inline error row with a Try again button (`ds/InlineError`) on Campaigns, Leads and Billing; other pages follow as they are touched.
- **Loading.** Pages wait on the server and show nothing: NEXT skeletons for the five heaviest pages (Today, Calls, Chats, Leads, Reports).
- **Keyboard.** Cmd+K focuses the Today composer. NEXT: a command palette that is the same list as the assistant's actions (go to, filter, switch theme).

## Today
Owner is trying to: see what needs me, tell the assistant what to do, watch a live call.
- KEEP the dark glossy band with the command bar, the status card, Needs you, Today's visits, results. It reads in two seconds.
- DONE: input at the bottom with the messages above (#657), multi-line field, Talk live and typed chat are one thread that survives a reload (#665), balance row shows the amount, "sent to you" counts real transfers (#638), no planning text in Needs you (#638/#639).
- CHANGE: the second status line under the greeting repeats the enquiries number that the results card shows again ("68 new enquiries" three times on one screen). NEXT: say it once in the briefing, drop it from the card header.
- CHANGE: "Your day" timeline shows only calls and visits as dots; add the next planned item as text. NEXT.
- ADD: a one-line "assistant did this" feed (the Done · Undo chips of the browser actions and the message cards) under the band. NEXT, after the action registry is deployed.

## My assistant
Trying to: make it sound right, tell it the rules, try it, go live.
- KEEP the five tabs and "Using defaults" markers. CHANGE: the practice panel competes with the form on narrow laptops (two columns under 1280). NEXT: panel under the form below 1280. ADD: "How it talks to you" is per person, the others are per business: one sentence on the tab says so.

## Calls
Trying to: find a call, hear it, act on the outcome, watch live calls (Retell / Bolna set the bar: filters, live monitor, transcript with actions).
- KEEP the status chips with counts, the table and the right panel with transcript, Teach this and the outcome card. ADD: the filters are in the address (status, when, search) so the assistant can open them: DONE in the action registry (#669). NEXT: save a filter as a named view ("Missed this week").

## Chats
Trying to: read, approve the reply, answer (WhatsApp Business sets the feel).
- KEEP the three columns and the REPLY READY card. DONE (15 Nov): the reply field is the Today composer's (grows to six lines, Enter sends, Shift+Enter a new line, Enter is a new line on a touch screen; the mic inside). ADD: Leads and Chats take `status` and `q` in the address so the assistant can filter them (C1 asked).

## Leads
Trying to: see who asked, who to call next, add people.
- DONE (this PR): "New" no longer appears twice in a row (the name badge and the status column both said New); the date and the "Where from" header stay on one line (they wrapped to two).
- DONE (15 Nov): the "Add leads" sub-tab is gone from the row (the big "Add leads" button does the same; the page is still open at its address and is drawn as a tab when it is the open page).
- DONE (15 Nov): Leads | Follow-ups | Visits stay in the row; Map, Find retailers and Sites sit under "More".
- DONE (15 Nov): the empty right panel shows the lead to look at first (name, why, one button) until one is picked: ready to buy first, then new ones nobody contacted, then the rest.
- ASK nothing: no money, consent or legal text touched.

## Campaigns
Trying to: start a calling or WhatsApp list, see how it is going.
- CHANGE: one long page of five stacked blocks (Hot leads, Standing rules, Start a new list, How calling works, tasks) with an error line in the middle. DONE (15 Nov, #689): the lists first, then hot leads and "Start a new list" (the plan card flow), then ONE collapsed "Rules" block (standing rules, calling hours and tries). REMOVE the "How calling works" paragraph block: its content is the calling hours line that the Rules block shows.
- CHANGE: "Lead plans" / "Tasks" tabs: two names for one thing to an owner. NEXT: one list called Campaigns.

## Reports
Trying to: know if it is working: enquiries → visits → sales, cost per visit.
- KEEP: results first, one chart per section, "today so far" dot. ADD: "ask a question" box at the top that is the assistant (the report answers are already assistant tools).

## Catalogue
Trying to: keep prices and photos right, publish.
- CHANGE: one name for the page. DONE (15 Nov, J38): the page title is "Catalogue" and its tabs are "Products" and "Item types" (the second tab and the page it opens have the same words, owner rule 15 Nov) (the old title and tab name overlapped). CHANGE: draft cards without a photo are big grey boxes. DONE (J38): a draft keeps its photo with a Draft pill; a saree with no photo gets a small "Add photo" prompt; the Edit link under each card is visible again. KEEP the drafts banner (it says the next step).

## Phone number
Trying to: get a number and know the state of the line. (Skeleton loading states: every screen under /app already shows the shape of a page while it loads (app/app/loading.tsx, job BW): nothing to build.)
- CHANGE: two cards say "Not set up yet" (Your business number, Calling number), plus a banner that says the numbers are made up, plus an orphan "Change the voice" link. One thing, said four times. DONE (15 Nov, #687): ONE card: state of the line, the city choice, "Get a number" (the price rule stays: price shown and a yes before anything is bought: ASK not touched). The "made up" banner shows only in a demo workspace. The voice link moves to My assistant, where the voice is.

## Billing
Trying to: see what is left, add money, change plan, get an invoice.
- KEEP: balance, plan and plans side by side, GST line, invoices. CHANGE: "Change plan" button and three "Choose this plan" links do the same; NEXT keep the plans row, drop the button. The balance appears in the menu and on the page: that is on purpose (the menu one is the quick top-up). ASK: money page, so no removal without a yes from the owner.

## Settings
First pass. Seven plain cards, only Business edits in place. CHANGE: "Developer" and "Activity" are internal words for an owner: NEXT rename to "Connections" and "What your assistant did". Privacy and data stay a human-only draft.

## Onboarding (day one)
KEEP the seven steps with times and "Just talk". CHANGE: step names should match the menu words (Catalogue, Phone number). NEXT.

## Phone layout
KEEP the bottom bar (Hold to speak) and swipe cards. CHANGE: the composer there is a one-line pill with no send button; with multi-line it needs a send arrow. DONE (15 Nov): the field grows (four lines) and a send arrow appears when something is written; Enter is a new line on a phone.

## Staff console
Separate route, English only, internal by design. CHANGE: nothing visual beyond the new tokens (DONE #668). Phase 3 screens come as C1's contracts land.

## Order of the next slices (one PR each, pictures after each)
1. This PR: audit v1 + Leads cleanup.
2. Phone number: one card. Campaigns: inline error row, one list, rules collapsed.
3. Leads tabs behind "More"; right panel shows the best next lead. Counts: menu badge vs page.
4. Catalogue tabs and photo prompts; Billing duplicate button (after the owner's yes).
5. Skeletons for Today, Calls, Chats, Leads, Reports; command palette.
6. Calls saved views; Chats composer; Reports ask box; phone send arrow.
