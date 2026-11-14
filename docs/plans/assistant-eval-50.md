# The assistant's acceptance eval: 50 real owner commands (14 Nov 2026)

Owner: a slice is DONE only when its commands pass end to end. Run `python3 scripts/assistant_acceptance_eval.py` after every staging deploy; the report goes to `~/Desktop/stack19-jobs/eval/`. The run stops at the card (nothing is approved, so no call, message or write happens); the end-to-end checks of each slice are in its tests and its own staging check. Source: `docs/plans/assistant-eval-50.json`.

Result words: `setting_card` a plan card whose step is a settings write; `plan_card`; `call_plan` (plan card with who, goal, opening line, questions); `message_card` (acted: Sending ... Undo); `done_undo` (a plan card that is already Done, with its Undo: the run undoes it again); `choose_card`; `client_action` (the browser does it: theme, language, navigation, filters, Talk live; C2's registry); `file_preview` (needs a file: skipped by the runner); `acted`; `clarify` (ONE short question); `answer` (from the records).

| # | Area | Lang | The owner says | Expected | Last run |
|---|---|---|---|---|---|
| 1 | settings | en | Make the daily call limit 120 | `setting_card` · Calls per day: 100 -> 120, Undo |  |
| 2 | settings | te | రోజుకు కాల్స్ లిమిట్ 150 చేయండి | `setting_card` · spoken Telugu; same card |  |
| 3 | settings | en | Switch off automatic sending and set quiet hours from 22 | `setting_card` · two fields of the outbox settings |  |
| 4 | settings | en | Change my opening line to: Namaste, this is the AI assistant of Vijaya Silks, may I speak for a minute? | `setting_card` · opening line, language from the script |  |
| 5 | settings | en | Set my business city to Guntur and pincode 522001 | `setting_card` |  |
| 6 | settings | en | Calls should end after 120 seconds and leave a message on voicemail | `setting_card` · call behaviour |  |
| 7 | client | en | Switch to dark mode | `client_action` · theme |  |
| 8 | client | te | యాప్ భాషను తెలుగులోకి మార్చు | `client_action` · app language |  |
| 9 | client | en | Open Reports for this month | `client_action` · navigate with a period |  |
| 10 | client | en | Show Kalyani's chat | `client_action` · navigate to a record |  |
| 11 | client | en | Filter leads to new ones from this week | `client_action` · apply a filter |  |
| 12 | client | en | Start Talk live | `client_action` · start/stop Talk live |  |
| 13 | leads | en | Add Ravi Teja, +00 000 000 8101, Guntur as a lead | `file_preview` · a typed lead opens the import card today; the target is done_undo |  |
| 14 | leads | te | రవి తేజ +00 000 000 8102 ని లీడ్ గా చేర్చు | `file_preview` · a typed lead opens the import card today; the target is done_undo |  |
| 15 | leads | en | Change Aruna Naik's city to Vijayawada | `done_undo` · edit a lead (needs a record id) |  |
| 16 | leads | en | Add this contact to my leads | `clarify` · after a number in the turn before: asks for the name once |  |
| 17 | leads | en | Mark Bhavani Reddy as qualified and set her interest to 20 sarees | `done_undo` · status + note on a lead |  |
| 18 | leads | en | Archive the lead Bindu Menon | `done_undo` · sensitive: deleting |  |
| 19 | calls | en | Call Anitha Hegde | `acted` · act at once: 'Calling ...' (real only on a sandbox number) |  |
| 20 | calls | te | యశ్వంత్ రెడ్డికి కాల్ చెయ్యి | `clarify` · unknown person: asks for the number and offers to save |  |
| 21 | calls | en | Call all my new leads tomorrow | `plan_card` · a group: plan, one approval |  |
| 22 | callplan | en | Ask Anitha Hegde if she is interested in the new Kanchi pattu and wants a store visit | `call_plan` · who, goal, opening line, questions, outcomes |  |
| 23 | callplan | en | Also ask her about the price range | `call_plan` · edit by words: a new plan from the turn before |  |
| 24 | callplan | te | అనిత హెగ్డేని అడగండి ఆమెకి కొత్త కాంచీపట్టు కావాలా అని | `call_plan` |  |
| 25 | whatsapp | en | Send Anitha Hegde: how are you? | `message_card` · act: queued with Undo (manual outside the test fence) |  |
| 26 | whatsapp | te | అనిత హెగ్డేకి మెసేజ్ పంపు: ఎలా ఉన్నారు? | `message_card` |  |
| 27 | whatsapp | en | Send a WhatsApp message to Aruna Naik | `clarify` · asks once what to say |  |
| 28 | whatsapp | en | Send Bindu Hegde: hello | `choose_card` · several Kalyanis: names as buttons |  |
| 29 | followups | en | Follow up with everyone who asked about wedding sarees last week | `plan_card` · a group message plan |  |
| 30 | followups | en | What follow-ups are due today? | `answer` · records answer with numbers |  |
| 31 | visits | en | Book Aruna Naik for a visit on Saturday at 11 | `done_undo` · visits.book_visit |  |
| 32 | visits | en | Move Suresh Hegde's visit to Sunday 4 pm | `done_undo` · reschedule |  |
| 33 | visits | en | Cancel Ramesh K.'s visit | `done_undo` · cancel (sensitive) |  |
| 34 | visits | en | Who is visiting today? | `answer` |  |
| 35 | campaigns | en | Start a campaign for the new silk collection to all my customers | `plan_card` · campaigns: sensitive sending |  |
| 36 | catalogue | en | Set the price of Cream soft silk to 8,200 | `plan_card` · catalogue.put_item, old -> new |  |
| 37 | catalogue | en | How many Kanchi pattu sarees are in stock? | `answer` |  |
| 38 | catalogue | en | Update my prices from this price list | `file_preview` · with a price-list file attached |  |
| 39 | reports | en | How many new enquiries came today? | `answer` |  |
| 40 | reports | te | ఈ రోజు ఎన్ని కొత్త ఎంక్వైరీలు వచ్చాయి? | `answer` |  |
| 41 | reports | en | What is my balance and how many call minutes is it? | `answer` |  |
| 42 | reports | en | Which customers have not paid and how much? | `answer` |  |
| 43 | consent | en | Bhavani Reddy agreed to get WhatsApp messages from us | `done_undo` · record consent |  |
| 44 | consent | en | Stop messaging Bindu Menon | `done_undo` · suppress |  |
| 45 | files | en | Add these people to my leads (an Excel list attached) | `file_preview` |  |
| 46 | files | te | ఈ ఫోటోలోని వాళ్ళని లీడ్స్ లో చేర్చు (చేతిరాత ఫోటో) | `file_preview` · handwritten Telugu page |  |
| 47 | chains | en | Find 10 jewellery shops in Jayanagar, save them as leads and send them our catalogue | `plan_card` · one plan with several steps; one approval |  |
| 48 | chains | en | Add Ravi Teja as a lead, then call him and ask if he wants a store visit | `plan_card` · two steps; the second is a call plan |  |
| 49 | chains | en | Check who has not replied for 3 days and send them a reminder | `plan_card` · read, then a group message plan |  |
| 50 | chains | te | కొత్త లీడ్స్ అందరికీ మెసేజ్ పంపి, రేపు ఉదయం 11కి విజిట్ బుక్ చేయి | `plan_card` |  |
