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
| 10 | client | en | Show Kalyani's chat | `client_action` · navigate to a record: needs the open_record client action (not built: the registry has no way to open one person) |  |
| 11 | client | en | Filter leads to new ones from this week | `client_action` · a filter on Leads: the registry has call filters only (page calls); a leads filter is not built |  |
| 12 | client | en | Start Talk live | `client_action` · start/stop Talk live |  |
| 13 | leads | en | Add Ravi Teja, +00 000 000 8101, Guntur as a lead | `file_preview` · a typed lead opens the import card today; the target is done_undo |  |
| 14 | leads | te | రవి తేజ +00 000 000 8102 ని లీడ్ గా చేర్చు | `file_preview` · a typed lead opens the import card today; the target is done_undo |  |
| 15 | leads | en | Change Aruna Naik's city to Vijayawada | `done_undo` · edit a lead (needs a record id) |  |
| 16 | leads | en | Add this contact to my leads | `clarify` · after a number in the turn before: asks for the name once |  |
| 17 | leads | en | Mark Bhavani Reddy as qualified and set her interest to 20 sarees | `done_undo` · status + note on a lead |  |
| 18 | leads | en | Archive the lead Bindu Menon | `done_undo` · sensitive: deleting |  |
| 19 | calls | en | Call Anitha Hegde | `acted` · act at once: 'Calling ...' (real only on a sandbox number) |  |
| 20 | calls | te | యశ్వంత్ రెడ్డికి కాల్ చెయ్యి | `clarify` · unknown person: asks for the number and offers to save |  |
| 21 | calls | en | Call all my new leads tomorrow | `plan_card` · a group: plan card (the call_plan shape with the people, one approval) |  |
| 22 | callplan | en | Ask Anitha Hegde if she is interested in the new Kanchi pattu and wants a store visit | `call_plan` · who, goal, opening line, questions, outcomes |  |
| 23 | callplan | en | Also ask her about the price range | `call_plan` · edit by words: a new plan from the turn before |  |
| 24 | callplan | te | అనిత హెగ్డేని అడగండి ఆమెకి కొత్త కాంచీపట్టు కావాలా అని | `call_plan` |  |
| 25 | whatsapp | en | Send Anitha Hegde: how are you? | `message_card` · act: queued with Undo (manual outside the test fence) |  |
| 26 | whatsapp | te | అనిత హెగ్డేకి మెసేజ్ పంపు: ఎలా ఉన్నారు? | `message_card` |  |
| 27 | whatsapp | en | Send a WhatsApp message to Aruna Naik | `clarify` · asks once what to say |  |
| 28 | whatsapp | en | Send Bindu Hegde: hello | `choose_card` · several Kalyanis: names as buttons |  |
| 29 | followups | en | Follow up with everyone who asked about wedding sarees last week | `plan_card` · a group message plan |  |
| 30 | followups | en | What follow-ups are due today? | `answer` · records answer with numbers |  |
| 31 | visits | en | Book Anitha Hegde for a visit on Saturday at 11 | `done_undo` · visits.book_visit |  |
| 32 | visits | en | Move Anitha Hegde's visit to Sunday 4 pm | `done_undo` · reschedule |  |
| 33 | visits | en | Cancel Anitha Hegde's visit | `done_undo` · cancel (sensitive) |  |
| 34 | visits | en | Who is visiting today? | `answer` |  |
| 35 | campaigns | en | Start a campaign for the new silk collection to all my customers | `plan_card` · campaigns: sensitive sending |  |
| 36 | catalogue | en | Set the price of Pure silk 3-cord to 8,200 | `plan_card` · catalogue.put_item, old -> new |  |
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
| 51 | self | en | Send me: test from Stack19 | `message_card` · 'me' is the signed-in owner's own number from the profile, never asked for; acts with Undo (the eval first puts an existing demo contact's number on the demo owner's profile) |  |
| 52 | self | te | నాకు WhatsApp పంపు: test | `message_card` · the same in Telugu; the owner's own typed words are accepted whatever their language |  |
| 53 | records | en | check if kalyani's contact is there or not? | `records_answer` · the owner's own thread (14 Nov, 23:05): after 'Draft a WhatsApp for Kalyani: how are you' and 'yes do it'. Must come back WITH the answer from the records in the same reply; no 'I'll check', no 'I can't see' |  |
| 54 | records | en | yes do it | `choose_card` · after 'Draft a WhatsApp for Kalyani: how are you': a plain yes to a drafted message is acted on, not answered by the chat step again. The demo workspace has three Kalyanis, so it asks which one (the owner's own workspace has one: the message is sent) |  |
| 55 | sources | en | Connect my IndiaMART | `client_action` · navigate to the sources page with the IndiaMART card open (page lead_sources, card indiamart); the owner pastes the key there: the assistant never asks for a key in the chat |  |
| 56 | sources | te | నా IndiaMART కనెక్ట్ చేయి | `client_action` · the same in Telugu |  |
| 57 | sources | en | Test my website form | `acted` · one marked test lead (is_test, +00 number) through the real intake; the answer says it arrived and that nobody is called or messaged |  |
| 58 | sources | te | నా వెబ్‌సైట్ ఫారమ్ టెస్ట్ చేయి | `acted` · the same in Telugu |  |
| 59 | sources | en | Where did my enquiries come from this week? | `records_answer` · counts per source from the records, test leads left out; no 'I can't see' |  |
| 60 | sources | en | Disconnect my Google Sheet | `plan_card` · disconnect revokes the link and keeps every lead; a plan card with its Undo (turn it back on) |  |
| 61 | speed | en | Call new leads from Meta within 5 minutes | `setting_card` · speed-to-lead rule for Meta only: in calling hours call within 2 -> 5 minutes, Undo; the other sources keep the default |  |
| 62 | speed | te | కొత్త లీడ్స్ కి 2 నిమిషాల్లో కాల్ చేయి | `setting_card` · the default rule: call within 2 minutes in calling hours; spoken Telugu |  |
| 63 | speed | en | If nobody answers, try 3 times, 4 hours apart, then send a WhatsApp | `setting_card` · retries: max attempts 3, gap 4 hours, then WhatsApp |  |
| 64 | speed | en | What did a visit from IndiaMART cost me? | `records_answer` · cost per visit for IndiaMART from the report; when no cost per lead was entered it says so and offers to set it (no invented number) |  |
