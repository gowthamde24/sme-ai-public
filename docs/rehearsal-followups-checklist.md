# Follow-up rehearsal click checklist (by hand, in the browser)

Purpose: count what it really costs a person to work a lead through a follow-up in the plain follow-up screens, and see with your own eyes every refusal the system gives, so you can set the number and the wording against the family's current way. Nothing here is automated, and nothing here is real: every person, customer and message is invented, on your own machine. **This system sends nothing to anyone.** A follow-up here is a *draft* for a person to send outside the system; the system only keeps a record of what you tell it you did.

Words inside double quotes below are the exact sentences the screens show (a test checks that each one exists in the screens' code). Words in `backticks` are the fixed texts the database makes. Anything with a date or a time in it is written as a gap to fill in.

## Before you start (once)

1. In a terminal, from the repository: `make rehearse-prepare-followups`. It needs the local stack running (`make db-start`) and **does not need `make db-reset`**: every run makes a new workspace called *Follow-up rehearsal* plus the time (the newest is the one it prints). It makes the people, a follow-up policy in force and **twelve leads** (below). It prints a web address for each lead, for the due list and for the questions page, and how to sign in as the Owner, an Admin, a Sales user and a Viewer.
2. Start the two servers the usual way: `make dev-api` and `make dev-web` (ports 8000 and 3000). Optional: contacts you add by hand are only protected by the do-not-contact list if the API has a suppression key; the script prints the one-line command that gives it a synthetic one. The twelve prepared contacts are already keyed.
3. Open **one private window per person** (Owner, Admin, Sales, Viewer). Sign in at `http://localhost:3000/login` with the printed e-mail and password, add each person's printed *authenticator key* to an authenticator app (enter the key by hand: 6 digits, 30 seconds, SHA-1) and use the 6-digit code when the sign-in asks for it. For the two steps that say **password only**, use one more private window and sign in with the password but do not give the code.
4. Do it **within a few hours** of preparing: the policy makes the recipient's clock read about noon *when you prepare*. If you come back another day, prepare again (a new workspace).
5. Stopwatch: start it when you read the step, stop it when the page shows the result. Write the **seconds**, and tick **Pass** only if you saw exactly what the step says. Count a mistake and its correction too: that is the point. If something differs, write what you saw in the last column of the notes at the end.

The twelve leads (each has a keyed contact who gave consent for e-mail and WhatsApp, except lead 11, who has **only a phone number** and gave consent for WhatsApp only, and lead 12, who **withdrew e-mail consent after the first message**; every lead except 6 and 8 has a first message recorded as sent by a person, lead 11's on WhatsApp):

| Lead | Company (as the lead page shows it) | State |
| --- | --- | --- |
| 1 | FU1 Due Now Silks | one message 5 days ago: **due now** |
| 2 | FU2 Not Yet Sarees | one message 1 hour ago: **not yet** |
| 3 | FU3 Replied Weaves | the customer replied |
| 4 | FU4 Opted Out Traders | the contact opted out |
| 5 | FU5 Order Accepted Looms | the customer accepted an order |
| 6 | FU6 Never Contacted Silks | no first message recorded yet |
| 7 | FU7 Three Touches Sarees | three messages already: the limit |
| 8 | FU8 Questions Weaves | an enquiry whose requirement has missing details |
| 9 | FU9 Reply After Draft Silks | due now (used for the stale-draft step) |
| 10 | FU10 Shared Number Silks | due now by e-mail; its **WhatsApp** number is also lead 4's, whose contact opted out: WhatsApp is blocked |
| 11 | FU11 Phone Only Silks | a phone number only (no e-mail address): one WhatsApp message 5 days ago, **due now on WhatsApp**; e-mail is closed |
| 12 | FU12 Email Withdrawn Weaves | one e-mail 5 days ago, then e-mail consent withdrawn: **due now on WhatsApp**; e-mail is closed |

**Channels.** A lead's follow-up page has two tabs, *E-mail* and *WhatsApp*, each saying whether its channel is open or why not; the due list has **one row per lead** and names the state of both channels. The list's link opens the lead on the channel to start with: the channel of an open draft, else the channel of the last message you sent while that channel is open, else e-mail, else WhatsApp. "Ask for a draft" is offered only on an open tab.

**Finding your way:** the follow-up screens do not show the company's name, so use the printed addresses (the script lists them by lead number and company, with the WhatsApp tab's address for leads 10, 11 and 12). On a lead's follow-up page the link "← Lead" opens the lead itself, where the company is named.

Where things are: the menu has "Follow-ups due" (the due list) and, on a lead, "Follow-up for this lead →". The due list has a link "The follow-up policy".

---

## A. The due list and the policy (Owner, then Sales)

| # | Who | Do | You should see | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| A1 | Owner | Menu → "Follow-ups due" | the heading "Follow-ups due"; the note "Worked out when you opened this page. Guidance only: the database decides again when you ask for a draft."; the line "Oldest first. Leads that need no follow-up (replied, limit reached, closed, opted out) are not listed."; and the banner "Follow-ups are drafts for a person to send outside this system." | | ☐ |
| A2 | Owner | Count the rows of the list | **six** rows, oldest last message first: five marked "Due now" (leads 1, 9, 10, 11 and 12) and, last, one "Not yet" (lead 2). Leads 3, 4, 5, 6, 7 and 8 are **not** listed: lead 3's customer replied and lead 7 reached the touch limit (a lead that needs no follow-up is not on the list), lead 4's contact opted out and lead 5 has an accepted order (a blocked or stopped lead is never due), leads 6 and 8 have no recorded first message. Row sentences: "A follow-up draft can be made now." and "It is not time for the next follow-up yet." Under each row's sentence a smaller line names the state of each channel, *E-mail: open · WhatsApp: open · opens on E-mail*, ending "opens on" and the channel the row will open the lead on (leads 11 and 12: *E-mail: no recorded consent or address · WhatsApp: open · opens on WhatsApp*; lead 10: *WhatsApp: on the do-not-contact list · opens on E-mail*). There is no "Show the next leads" link and no note about leads left out: this workspace has fewer than 30 candidates. *(The earlier version of this checklist said seven rows; the right count was six before leads 11 and 12 existed, and it was eight before the list stopped showing leads that need no follow-up.)* | | ☐ |
| A3 | Owner | Press "The follow-up policy" | the heading "The follow-up policy" and **Version 1**, starting today, "in force today": touches at most 3; days to wait 1, 2; quiet hours 03:00 to 04:00; all seven weekdays; no holidays; minimum gap 0 hours | | ☐ |
| A4 | Owner | In "Publish a policy version" change **Starts on** to **tomorrow** (leave the rest) → "Publish this policy". *Do not start it today: that would replace the policy the rest of this checklist needs.* | the message "The policy is published. It applies from the day you chose."; the list now shows **Version 2**, starts tomorrow, *not started yet*, and Version 1 still *in force today* | | ☐ |
| A5 | Sales | Open the policy page | the versions are listed; no form; the sentence "Only the owner publishes a policy." | | ☐ |
| A6 | Owner, **password only** | Open the policy page | instead of the form: "Publishing a policy needs your authenticator app." with a link to the Security page | | ☐ |

Total for A: seconds ______

## B. The happy path: lead 1, Due Now Silks

Use the printed address of lead 1.

| # | Who | Do | You should see | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| B1 | Owner | Open lead 1's follow-up page | the heading "Follow-up"; "Nothing blocks a follow-up for this lead."; "Guidance only: the database decides again when you ask for a draft."; "A follow-up draft can be made now." followed by "(This would be touch 2.)"; "No drafts yet."; under "Touches" one entry: *You sent it yourself · E-mail*, about five days ago; above the sections, two tabs *E-mail* (the current one, in bold) and *WhatsApp*, each followed by "open"; two forms, "Ask for a draft" (it names its channel, *Channel: E-mail*, and has no channel choice) and "Record a touch" (its channel starts on E-mail) | | ☐ |
| B2 | Sales | Open the same page, press "Ask for a draft" (it is for the tab you are on: E-mail) | the message "A draft for touch 2 was made. Read it, approve it, then send it yourself outside this system."; a draft card "Draft: waiting for approval" with the sentence "This is the text you review. It is a fixed template: nothing here can be edited." and the text `Hello, I am following up on my earlier message about your saree requirement. If you would like me to share the details again, or if anything is unclear, please reply here and I will be glad to help.` There is **no** "Approve this text" button for Sales; "Discard this draft" is there (it is Sales's own draft) | | ☐ |
| B3 | Admin, **password only** | Open the same page | on the draft, instead of the Approve button: "Approving needs your authenticator app." with a link to the Security page | | ☐ |
| B4 | Admin | Open the same page, press "Approve this text" | the message "Approved. Copy the text and send it yourself, then record that you sent it."; the card now says "Approved: ready for you to send yourself" and offers "Record: I sent it myself" | | ☐ |
| B5 | Admin | Press "Copy the text", then paste somewhere | the message "Copied. Paste it into your own message." and the pasted text is the draft's text. (Sending it is yours to do, outside this system: do not look for a button, there is none.) | | ☐ |
| B6 | Sales | Leave the time empty, press "Record: I sent it myself" | the message "Recorded: you sent it yourself. Nothing was sent by this system."; the card says "Recorded: you sent it yourself"; under "Touches" there are now two entries; the guidance line is now "It is not time for the next follow-up yet." followed by an earliest time two days away | | ☐ |
| B7 | Sales | Press "Ask for a draft" again | the refusal "It is not time for the next follow-up yet." and no new draft | | ☐ |
| B8 | Owner | In "Record a touch" type a time **in the future** (or try to) | the browser does not accept it, or the form says "A touch cannot be in the future. Leave the time empty for now." Nothing is recorded | | ☐ |
| B9 | Owner | In "Record a touch" choose "They replied", leave the time empty, press "Record this" | the message "Recorded: they replied."; the guidance line becomes "The customer replied: a person takes over." | | ☐ |

Total for B: seconds ______ (and: how many times did you change person or window? ______)

## C. Each refusal, lead by lead (the Owner presses "Ask for a draft" on each)

For each lead: open its follow-up page, read the lines, then press "Ask for a draft" and compare the refusal.

| # | Lead | You should see on the page | After "Ask for a draft" | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| C1 | 2, Not Yet | "Nothing blocks a follow-up for this lead."; "It is not time for the next follow-up yet." and an earliest time about a day after the touch | "It is not time for the next follow-up yet." | | ☐ |
| C2 | 3, Replied | "The customer replied: a person takes over." | "The customer replied: a person takes over." | | ☐ |
| C3 | 4, Opted Out | under "Is anything blocking a follow-up?": "This person has asked not to be contacted." and **nothing else about the rules**: no "What the rules say now" section, no sentence that a draft can be made | "This person has asked not to be contacted." | | ☐ |
| C4 | 5, Order Accepted | under the blocks: "An order for this lead was accepted: follow-ups stop." and **nothing else about the rules**: there is no "What the rules say now" section and no sentence that a draft can be made (the rules do not know about orders, so a stopped lead is never shown as due) | "An order for this lead was accepted: follow-ups stop." | | ☐ |
| C5 | 6, Never Contacted | "Nothing recorded yet. The first message is yours: write it, send it yourself, then record it here."; the guidance "There is no first message yet: the first message is a person's. Record it, then follow-ups can start." | "There is no first message yet: the first message is a person's. Record it, then follow-ups can start." | | ☐ |
| C6 | 7, Three Touches | three entries under "Touches"; the guidance "The policy's limit of touches is reached." | "The policy's limit of touches is reached." | | ☐ |
| C7 | 10, Shared Number (press the tab *WhatsApp*, or open the printed WhatsApp address, which ends in `?channel=whatsapp`) | WhatsApp tab: the tab line reads *WhatsApp · on the do-not-contact list*; under the blocks "This e-mail address or phone number is on the do-not-contact list." and no "What the rules say now" section, and **no** "Ask for a draft" form. Then press the tab *E-mail*: *E-mail · open*, "Nothing blocks a follow-up for this lead." and "A follow-up draft can be made now." followed by "(This would be touch 2.)". *Do not ask for a draft on the e-mail tab: this lead is only here to be read twice* | the WhatsApp tab offers no "Ask for a draft" (the system refuses it anyway: "This e-mail address or phone number is on the do-not-contact list.") | | ☐ |

Total for C: seconds ______

## D. A draft that goes out of date when the customer replies: lead 9

Two windows side by side (Admin and Owner), both on the page of lead 9.

| # | Who | Do | You should see | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| D1 | Owner | Press "Ask for a draft" | the message "A draft for touch 2 was made. Read it, approve it, then send it yourself outside this system." and the draft waiting for approval | | ☐ |
| D1a | Owner | Press the tab *WhatsApp* | the tab is open (*WhatsApp · open*), but instead of "Ask for a draft" a note: "Work on it there, or discard it first: a follow-up has one draft, on one channel." with the link *Open the E-mail tab*. (One follow-up has one draft, on one channel.) Press *Open the E-mail tab* to come back | | ☐ |
| D2 | Admin | Reload the page (so the draft and its Approve button are showing). **Do not press Approve yet** | the draft with "Approve this text" | | ☐ |
| D3 | Owner | In "Record a touch" choose "They replied", leave the time empty, "Record this" | "Recorded: they replied."; the draft is now *Discarded*, with the reason *the customer replied*, and has no buttons | | ☐ |
| D4 | Admin | In the **old** window press "Approve this text" | the refusal "That draft is not waiting for approval." and the page reads itself again: the draft is shown as discarded | | ☐ |
| D5 | Owner | Press "Ask for a draft" | "The customer replied: a person takes over." | | ☐ |

Total for D: seconds ______

## E. The questions for a requirement: lead 8

| # | Who | Do | You should see | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| E1 | Sales | Open the questions page of lead 8 (the printed address; or lead 8 → its enquiry → "Stored questions for the customer →") | the heading "Questions for the customer"; "No questions stored. Update them from the requirement."; the banner about drafts for a person to send outside the system | | ☐ |
| E2 | Sales | Press "Update the questions from the requirement" | the message "The questions were updated from the requirement." and **three** questions (in some order), each marked "Draft": `By what date do you need the order delivered?` / `Which payment terms would you prefer: advance payment, credit days, or cash on delivery?` / `How many pieces do you need of Kanjivaram?` | | ☐ |
| E3 | Sales | Press the same button again | the message "The questions are up to date." and nothing new | | ☐ |
| E4 | Sales | On the first question press "Approve this question" | the message "Approved. Copy it and ask the customer yourself."; the question is marked "Approved: ready to copy" | | ☐ |
| E5 | Sales | On the same question press "Discard this question" | the message "Discarded."; the question is marked "Discarded" and its text is gone from the page | | ☐ |

Total for E: seconds ______

## E2. WhatsApp as a channel: leads 11 and 12 (and the tabs of 9 and 10)

Nothing is sent: a WhatsApp draft is the same fixed text a person copies and sends outside the system (the wording is a synthetic placeholder, identical to e-mail).

| # | Who | Do | You should see | Seconds | Pass |
| --- | --- | --- | --- | --- | --- |
| E2.1 | Sales | Open the due list, press the "Due now" link of lead 11's row (FU11, a phone number only) | the page opens on the **WhatsApp** tab (the address ends in `?channel=whatsapp`); the tab line reads *E-mail · no recorded consent or address* and *WhatsApp · open*; "Nothing blocks a follow-up for this lead."; "A follow-up draft can be made now." followed by "(This would be touch 2.)"; the form "Ask for a draft" says *Channel: WhatsApp*; under "Touches": *You sent it yourself · WhatsApp* | | ☐ |
| E2.2 | Sales | Press "Ask for a draft" | the message "A draft for touch 2 was made. Read it, approve it, then send it yourself outside this system."; a draft card with the text `Hello, I am following up on my earlier message about your saree requirement. If you would like me to share the details again, or if anything is unclear, please reply here and I will be glad to help.` and *WhatsApp* in its heading | | ☐ |
| E2.3 | Admin | Open the same page (WhatsApp tab), press "Approve this text", then Sales presses "Record: I sent it myself" | "Approved. Copy the text and send it yourself, then record that you sent it." then "Recorded: you sent it yourself. Nothing was sent by this system."; two entries under "Touches", both *WhatsApp* | | ☐ |
| E2.4 | Sales | Press the tab *E-mail* | the tab line shows *E-mail · no recorded consent or address*; the line under the blocks "There is no recorded consent for this channel, or no address for it."; **no** "Ask for a draft" form; "Record a touch" is still there | | ☐ |
| E2.5 | Sales | Open lead 12's due row (FU12, e-mail consent withdrawn) | the page opens on the **WhatsApp** tab (an e-mail was the last message you sent, but that channel is closed); *E-mail · no recorded consent or address*, *WhatsApp · open* | | ☐ |
| E2.6 | Sales | On lead 12's *E-mail* tab | "There is no recorded consent for this channel, or no address for it." and no "Ask for a draft" | | ☐ |
| E2.7 | Sales | On lead 10's due row (FU10) | the row ends "opens on" E-mail; the page opens on the E-mail tab: *E-mail · open*, *WhatsApp · on the do-not-contact list* | | ☐ |

Total for E2: seconds ______

## F. What a Viewer sees (not counted)

| # | Who | Do | You should see | What you saw |
| --- | --- | --- | --- | --- |
| F1 | Viewer | Open the home page | **no** "Follow-ups due" item in the menu | |
| F2 | Viewer | Open the due list, a lead's follow-up page, the policy page and the questions page (printed addresses) | on each, only the heading and the sentence "Follow-ups are shown to owners, admins and sales users." No list, no draft text, no button | |

## G. What you must NOT see, anywhere on these screens

Tick each box when you have looked and it is true:

- ☐ No button or link that says **Send** (not *Send now*, *Send e-mail*, *Send on WhatsApp*, or anything like it). Only "Record: I sent it myself" and "Copy the text".
- ☐ No box where you can type or change the **wording** of a draft or a question. (The only boxes are times, numbers, dates, the weekdays and the holidays of the policy.)
- ☐ Nothing that says a message **was sent by the system**. Every message about a send says "Nothing was sent by this system" or that *you* sent it.
- ☐ No e-mail address or phone number of a contact on any follow-up screen.
- ☐ No word about anyone being **erased**, no *erased key*, no *shared address* and nothing about *another* person: a contact on the do-not-contact list only ever reads "This person has asked not to be contacted." or "This e-mail address or phone number is on the do-not-contact list."
- ☐ No "Ask for a draft" form on a tab that says why it is closed, and no channel choice inside the draft form (the tab decides).
- ☐ No raw error: no HTTP numbers (403, 409), no codes written with underscores, no database or stack text. Every refusal is one plain sentence from the list above.
- ☐ No "Approve this text" button for Sales, and nothing at all for a Viewer.

## H. Not in the browser (the script covers it: `make rehearse-followups`)

- The server's refusal of an approval from a session without the authenticator code, and of an approval of a text other than the one shown (the screens never offer either; the script sends them on purpose).
- Sales approving, a Viewer asking for anything, and every refusal above, by code and by reason, plus that the same request sent twice changes nothing and that no route, setting or table that could send a message exists.
- The due list as a PAGE (the script only; the prepared workspace has twelve leads, which is one page): the script adds 35 more keyed leads, all older than the prepared ones, and walks the list by cursor: page 1 holds the 30 oldest leads in order and a cursor, page 2 the last five of them and then the prepared leads that can still be due, the lead written to an hour ago last; nobody is listed twice; no lead that needs no follow-up is on any page; a cursor that is not ours (or longer than 200 characters) is refused; a Viewer cannot ask for a later page.
- WhatsApp as a first-class channel (leads 11 and 12 and the tabs): the script takes lead 11 through WhatsApp end to end (a draft, Sales refused to approve, the Admin's approval, "I sent it"), asks for an e-mail draft for leads 11 and 12 (refused for consent), asks for a WhatsApp draft while an e-mail draft is open (refused: one draft per touch), and checks every lead's channel states, default channel and the open draft's channel. The real WhatsApp wording, and how a person sends it, are the owner's decisions (`docs/pre-pilot-checklist.md`).
- Suppression keys: there is **no screen** to record keys for an existing contact (the Owner's `POST /suppression/backfill` endpoint exists, with `GET /suppression/status`, but nothing in the web calls them). A contact with no key reads "This contact has no suppression key recorded yet, so it cannot be contacted. Recording keys for existing contacts is not available on any screen yet." Contacts made through the API with a key configured are keyed when they are made; the script proves the twelve prepared contacts are (lead 11 has a phone key only: it has no e-mail address).

## I. Summary

| Part | Seconds | Window changes | Notes |
| --- | --- | --- | --- |
| A due list and policy | | | |
| B happy path | | | |
| C refusals | | | |
| D stale draft | | | |
| E questions | | | |
| E2 WhatsApp and the tabs | | | |

Notes: where did you stop and wonder what to do? Which word was unclear? Which lead could you not tell from another? Which entry did you want and not find?
