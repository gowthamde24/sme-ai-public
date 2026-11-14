# Google OAuth verification pack: "Calendar booking sync" (appointment booking, slice 5)

Prepared 14 Nov 2026 by C1. **The OWNER submits this.** No code here. Nothing in this file has been sent to Google.

Read with `docs/plans/appointment-booking.md` (slice 4 builds the feature, behind a fake Google, until the owner creates the OAuth client). Same shape as `docs/plans/meta-app-review.md`.

**Conventions**
- `TODO(owner)` = a fact or a decision only the owner has. Search this file for `TODO(owner)` before submitting. They are listed again at the end.
- `TODO(C1)` = something the slice 4 code must confirm or match before the video is recorded.
- The privacy and terms texts on the site are **DRAFTS the owner has not approved** (lawyer review pending). This pack links to the page paths and says so. Section 4 has new sentences written for approval; they are also DRAFT.
- Google facts below were read from Google's pages on 14 Nov 2026 (links in section 10). Google changes these pages; re-read the scope list and the verification pages on the day you submit.

---

## 1. What the app does (paste into "App description" / the first paragraph of the review)

Stack19 is an AI assistant for small businesses in India (shops, builders' suppliers, coaching centres, clinics). It answers the business's customers on WhatsApp, on phone calls and in a web chat, and it books appointments (store visits) for the business, only into times the business has open.

"Calendar booking sync" is an optional feature. A business owner can connect their own Google Calendar to Stack19 (OAuth, per owner; nobody else's calendar). When connected:

1. Each appointment a customer books through Stack19 is written as an event on the owner's Google Calendar, so the owner sees it in the calendar app they already use. If the customer reschedules or cancels in Stack19, the event is updated or deleted.
2. Before Stack19 offers a time to a customer, it asks Google whether the owner is busy then (free/busy only), so it does not offer a time that is already taken (a doctor's visit, a family event, a meeting booked directly in Google Calendar).
3. Google tells Stack19 when the calendar changed (push notification), so the offered times stay accurate between checks.

What it does not do: it never reads the titles, descriptions, guests or locations of the owner's other events; it only edits or deletes events that Stack19 itself created; it does not read contacts, mail or Drive; it does not sell or share Google data and does not use it for advertising or to train AI models. The owner can disconnect at any time (Stack19 revokes the token at Google and deletes its copy).

| Item | Value |
|---|---|
| App name on the consent screen | Stack19 |
| Company | Stack19, a sole proprietorship of SODANAPALLI GOWTHAM REDDY, Ananthapuramu, Andhra Pradesh 515001, India (as in `apps/web/lib/site/business.ts`) |
| Domain | stack19.com (staging: staging.stack19.com, which is not indexable) |
| Contacts | hello@stack19.com (support / developer contact), privacy@stack19.com (privacy and the Grievance Officer) |
| Who connects | A signed-in business Owner (Owner and Admin acts need the second factor, ADR 0016; **TODO(C1): confirm connecting Google Calendar is one of them**) |
| Who can use it before verification | Test users only (the owner's own Google account) |

---

## 2. Scopes

### 2.1 Which scopes, and why these two

Google's Calendar scope list (14 Nov 2026) has 20 scopes. The two that do the job with the least access:

| Need | Scope we request | Calls it allows (from Google's method pages) |
|---|---|---|
| (a) write our appointments as events; (c) receive push notifications | `https://www.googleapis.com/auth/calendar.events` | `events.insert`, `events.patch/update`, `events.delete`, `events.get`, `events.watch`, `channels.stop` |
| (b) read busy/free | `https://www.googleapis.com/auth/calendar.freebusy` | `freebusy.query` only |

Why two scopes and not one: `freebusy.query` does **not** accept `calendar.events` (Google lists only `calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy`). So writing events needs one scope and asking "is the owner busy" needs another. `calendar.events` already covers `events.watch` (it is on that method's list), so watching needs no third scope.

**Design commitment that keeps (b) and (c) narrow (TODO(C1): slice 4 must do exactly this).** A push notification has no body and does not say what changed (Google's push guide). When one arrives Stack19 does NOT call `events.list` (that would return other events' titles, because `calendar.events` allows it). It calls `freebusy.query` for the booking window (busy intervals only) and `events.get` only for events whose id Stack19 stored. So the code never lists or reads the owner's other events. Reviewers will ask; this is the answer.

### 2.2 Classification

| Scope | Google's description (consent screen text) | Sensitive / restricted? |
|---|---|---|
| `calendar.events` | "View and edit events on all your calendars" | **Sensitive** (not restricted). Our reading: Google's public pages do not state it; third-party verification guides list Calendar events scopes as sensitive. **TODO(owner): confirm** on Google Cloud console > Google Auth platform > **Data Access**, where each added scope is grouped as non-sensitive, sensitive or restricted. Write the answer here: ______ |
| `calendar.freebusy` | "View your availability in your calendars" | Same: **TODO(owner): confirm on the Data Access page**. Answer: ______ |

What follows from the class (Google's verification pages): sensitive scopes need Google's OAuth verification (Google says up to about 10 days; it can be longer), a scope justification, a demo video, a verified domain, a public homepage and a privacy policy. A restricted scope would add an annual third-party security assessment, which we do not expect for these two. If the Data Access page shows `restricted` for either, stop and tell C1 (the plan changes).

### 2.3 Why not a narrower or a different scope (paste-ready where marked)

| Scope considered | Why we do not use it |
|---|---|
| `calendar` (full) | Allows sharing settings, deleting whole calendars and reading everything. We need none of it. |
| `calendar.readonly`, `calendar.events.readonly` | Show titles and details of every event. We only need to know "busy or not", and `calendar.freebusy` gives that and nothing more. They also cannot write. |
| `calendar.events.freebusy` | Also allows `events.list` and `events.watch` on the owner's calendars. Google describes it as "See the availability". It could replace `calendar.freebusy`, but because we already hold `calendar.events` (which covers watch), `calendar.freebusy` is the narrower of the two for the single thing we need from it: `freebusy.query`. |
| `calendar.events.owned` | Narrower than `calendar.events` (events on calendars the user **owns**). It does accept `events.insert/watch`. **Open decision, TODO(owner) with C1:** if you are content that v1 writes only to a calendar the owner owns (the normal case: their own primary calendar), request `calendar.events.owned` instead of `calendar.events`; it is a tighter story for the reviewer. Cost: a newer scope with less public history, and we must be sure the owner's chosen calendar is one they own. This pack is written for `calendar.events` because that is what the plan and the owner named; if you switch, replace the URL in 2.4 and 2.5 and re-check the class on the Data Access page. |
| `calendar.app.created` | Narrowest for writing: Stack19 would create its own secondary "Stack19 appointments" calendar and write only there. But the owner wants bookings on their chosen (usually primary) calendar so they appear beside their other work, and this scope does not give busy times of the primary calendar. A fair fallback if Google refuses `calendar.events`: say so in the reply (section 8, question 3). |
| `calendar.calendarlist.readonly` (to let the owner pick a calendar from a list) | **Not requested.** `calendarList.list` needs it (or `calendar` / `calendar.readonly`). **Decision TODO(owner) with C1:** v1 writes to the owner's primary calendar (`primary`), so no picker and no extra scope. If a picker is wanted later it needs this scope added and a new verification round. The task text says "chosen calendar"; without this scope "chosen" means primary. |
| `openid` / `email` (to show "Connected as ...") | Not requested. The screen shows "Connected" and the calendar's name without the Google account e-mail. (Non-sensitive if you want to add it later.) |

### 2.4 Scope 1: `https://www.googleapis.com/auth/calendar.events`

| Field | Entry |
|---|---|
| Exact URL | `https://www.googleapis.com/auth/calendar.events` |
| Class | Sensitive (confirm, 2.2) |
| Feature that needs it | Appointments booked through Stack19 appear in the owner's Google Calendar; a change or cancellation in Stack19 updates or removes that event; Google tells us when the calendar changed (`events.watch`). |
| Data **written** | One event per Stack19 appointment, on the owner's calendar: start and end time (India time), a title that names the service and the customer (**TODO(C1): exact text; propose "Appointment: <first name + last initial>" with the service, and NO phone number or address in the event unless the owner switches it on**), a description line "Booked through Stack19" with a link back to the appointment in Stack19, and a private extended property holding the Stack19 appointment id. No guests are added and no invitations or e-mails are sent by Google (`sendUpdates=none`). **TODO(C1): confirm.** |
| Data **read** | Only events that Stack19 created, fetched by their stored event id (to see if the owner moved or deleted one). We never list, search or read other events. |
| Data **stored** | Per appointment: the Google event id (a mapping row, in our database). Per connection: the calendar id, the push channel id and resource id and its expiry time, the connection state. **The OAuth token is NOT in our database**: it is in Google Secret Manager (asia-south1, Mumbai), one secret per workspace, through the existing workspace-secrets mechanism (`WORKSPACE_SECRETS=gcp`; secret name pattern `sme-ws-<workspace>-<kind>`). |
| Retention / deletion | Mapping rows and channel records: until the owner disconnects, then deleted at once. Token: deleted from Secret Manager at disconnect (and when the workspace is erased). Events already written stay on the owner's Google Calendar (they are the owner's records; Stack19 stops touching them) **TODO(owner): confirm that is what you want; the alternative is "also delete the events we created" on disconnect (a checkbox).** |
| Who can see it | The workspace's Owner, through the app. Stack19 staff do not read it (see Limited Use, section 3). |

**Paste-ready justification (consent-screen form, scope `calendar.events`)**

> Stack19 is an appointment-booking assistant for small businesses. A business owner can connect their own Google Calendar. We use calendar.events only to (1) create an event on the owner's calendar for each appointment a customer books with that business through Stack19, (2) update or delete that same event when the customer reschedules or cancels in Stack19, and (3) call events.watch so Google tells us when the owner's calendar changed and we can keep our offered appointment times accurate. We only read, edit or delete events that Stack19 created; we never list or read the title, description, guests or location of any other event. The scope is requested only after the owner clicks "Connect Google Calendar" in Settings, and the owner can disconnect at any time, which revokes the token at Google and deletes our copy. A narrower scope is not enough: calendar.freebusy cannot create or change events, calendar.events.readonly and calendar.readonly cannot write, and calendar.app.created would put bookings in a separate calendar instead of the owner's own, where they need to see them next to their other commitments.

### 2.5 Scope 2: `https://www.googleapis.com/auth/calendar.freebusy`

| Field | Entry |
|---|---|
| Exact URL | `https://www.googleapis.com/auth/calendar.freebusy` |
| Class | Confirm on the Data Access page (2.2) |
| Feature that needs it | Stack19 must not offer a customer a time when the owner is already busy in Google Calendar (for a personal or other commitment). |
| Data **read** | Busy time ranges (start and end only) of the connected calendar, for the booking window (the days Stack19 is offering). Google returns no titles, descriptions, guests or locations for this call. |
| Data **written** | None (read only). |
| Data **stored** | (C1, as built) Busy ranges (start and end only, no event id, title or person) of the next 60 days in one table, `public.calendar_busy`, only while the owner's "block busy times" switch is on; the whole set is replaced on every refresh (every 30 minutes and about a minute after a push alert) and deleted at disconnect or when blocking is turned off. No client reads the times: the slot function asks the database a yes/no question per slot (`app.calendar_busy_overlaps`). |
| Use | Only to remove those ranges from the list of times Stack19 offers. A busy range never creates or changes a customer, a lead or any record, and is never sent to an AI model: the assistant only sees the finished list of open times. **TODO(C1): confirm no raw busy range goes into a model prompt.** |
| Retention | As above; deleted at disconnect. |

**Paste-ready justification (scope `calendar.freebusy`)**

> We use calendar.freebusy only to ask Google whether the connected owner is busy during the days we are offering appointments, so Stack19 does not offer a customer a time that is already taken in the owner's Google Calendar. The call (freebusy.query) returns only start and end times of busy periods, not event titles or details. We use it to hide those times from the list of open appointment slots and for nothing else; we keep only the start and end of each busy period for the next 60 days (replaced on every refresh and deleted when the owner disconnects), we do not show them to anyone, and we do not transfer them. A narrower scope does not exist: calendar.freebusy is the narrowest Google scope that can answer a free/busy query. The alternatives (calendar.readonly, calendar.events.readonly, calendar) would expose the titles and details of every event, which we do not need and do not want.

### 2.6 What is NOT requested

Contacts, Gmail, Drive, Sheets, the user's profile or e-mail, other calendar settings, ACLs, calendar creation. The Google sign-in the app already offers (Supabase, `docs/runbooks/social-sign-up.md`) uses only basic sign-in scopes and is separate from this feature.

---

## 3. Google API Services User Data Policy: Limited Use

Stack19 follows the Google API Services User Data Policy, including the Limited Use requirements, for all data received through `calendar.events` and `calendar.freebusy`.

### 3.1 The disclosure sentence (put it in the privacy policy, DRAFT, owner/lawyer approves)

> Stack19's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

(This is the sentence as companies publish it; Google's policy page does not print a mandatory form of words, it requires that you disclose and follow Limited Use. Keep the sentence word for word and add the plain-English list below it.)

### 3.2 The plain-English statement (DRAFT, goes under that sentence)

> What we do with your Google Calendar data, and what we never do:
> - We use it only to provide the booking feature you switched on: writing appointments to your calendar, and checking when you are busy so we do not offer that time.
> - We do not transfer it to anyone, except where needed for security (for example to investigate abuse), to comply with the law, or as part of a merger or sale of the business after we have your explicit consent.
> - We do not use it, or let anyone use it, for advertising, and we do not sell it.
> - We do not let people read it. Our staff cannot open your calendar data. The exceptions are the ones Google allows: you ask us to look at something specific and give consent, it is needed to investigate abuse or a security problem, or the law requires it.
> - We do not use it to train or improve AI models, and it is not sent to an AI model. The assistant only sees the list of times that are open.
> - Your Google token is kept in Google Secret Manager, not in our database.

TODO(C1): "staff cannot open your calendar data" must be true in practice: Secret Manager access limited to the API service account, no Google data in logs, error reports (Sentry) or the audit log (the audit log already holds no message text; keep Google event titles and busy ranges out of it too).

### 3.3 Where it must appear

| Place | What | Status |
|---|---|---|
| Privacy page `/privacy` (path `apps/web/app/(legal)/privacy`, text `apps/web/lib/legal/privacy-text.ts`, plus the te/hi/kn files) | New section "Google Calendar" with 3.1 and 3.2 (4.2 below) | DRAFT, to approve. Must be live and public before submitting |
| Connect screen in the app (Settings > Integrations > Google Calendar, before the "Connect Google Calendar" button; screen is built in slice 4 and the web by C2) | Two lines of plain text and the 3.1 sentence with a link to `/privacy`, shown **before** the owner is sent to Google, so the notice is "prominent, timely and in context" as Google asks. **TODO(C1/C2): route and exact text.** | To build |
| Homepage `https://stack19.com` | A link to the privacy page (Google requires the homepage and the consent screen to link the same policy) | Footer already links `/privacy`; **TODO(owner): check on the day** |
| OAuth consent screen (Google Cloud console) | Privacy policy link = `https://stack19.com/privacy` | Setup, section 6 |

---

## 4. Privacy policy: what Google requires, mapped to our DRAFT

Google's requirements (verification requirements and User Data Policy pages): the policy must be public, on the same domain as the homepage, linked from the consent screen and the homepage, and must say how the app **accesses, uses, stores and shares** Google user data; our use must stay inside what the policy says; the Limited Use disclosure must be included; in-app notices must be prominent.

### 4.1 Checklist against `apps/web/lib/legal/privacy-text.ts` (version 2026-10-27)

| # | Google needs | In our draft today | Missing, fix |
|---|---|---|---|
| 1 | Who we are and how to reach us | Intro: Stack19, `privacy@stack19.com`, security address | Nothing |
| 2 | What Google data is accessed | Section 2 table has no Google Calendar row. It says "We do not collect your contacts or address book", which stays true | Add the row (4.2-A) |
| 3 | Why / how it is used | Not stated for Google data | 4.2-A, 4.2-B |
| 4 | How it is stored, and where | Section 6 and the sub-processor list (Google Cloud, Mumbai) cover hosting; the token in Secret Manager is not mentioned | 4.2-B |
| 5 | Who it is shared with | Section 5: list drawn live from `GET /v1/privacy/subprocessors` (ids: google_cloud, supabase, resend, zoho, anthropic, meta_whatsapp, sarvam). Google Cloud is already there (hosting and Secret Manager). Google Calendar is the **source** of the data, not a processor of ours | Say it is not shared (4.2-B). **TODO(C1): confirm the Google Cloud row's "data" text covers the secret store; the list is code, not this pack** |
| 6 | AI: Google data not used to train models | Section 4 says records and text "are sent to an AI model provider" | Add the carve-out (4.2-C), otherwise a reviewer reads section 4 as covering calendar data |
| 7 | Limited Use disclosure | Absent | 3.1 and 3.2 inside 4.2-B |
| 8 | Retention | Section 7 table has no row | 4.2-D |
| 9 | How to delete / revoke | Section 9 covers account deletion and e-mail requests; no word on disconnecting Google | 4.2-E |
| 10 | Roles (who decides) | Section 1: we are the fiduciary for the account; the business is for its customers | 4.2-A notes it |
| 11 | Children | Section 8: not for under 18s | Nothing |
| 12 | Link on homepage and consent screen | `/privacy` exists; footers link it | Check on the day |
| 13 | Other languages (te, hi, kn) | Machine-written drafts for a native reader; English counts | New text needs the same three drafts and a native reader (owner step, already open) |
| 14 | Version, re-acceptance | Section 13: a material change gets a new `LEGAL_VERSION` and asks for acceptance again | **TODO(owner): decide whether this is "material"; if yes, bump the version and the people are asked again** |

Also update, when slice 4 lands (C1, not text for the owner): `docs/data-inventory.md` (the mapping rows, channel records, the secret), `/data-deletion` (one line: disconnecting Google Calendar), and the Terms section "third" (which names the outside companies: add "Google Calendar, if you connect it").

### 4.2 The missing sentences, written out (DRAFT: owner/lawyer approves; plain English like the rest)

**A. New row in the Section 2 table ("What data, and why")**

| What | Examples | Why |
|---|---|---|
| Your Google Calendar (only if you connect it) | A sign-in token from Google (kept in Google Secret Manager, not in our database); the appointments we wrote to your calendar and the id Google gave each one; the times you are busy (start and end only, no titles or details); the details of the change alerts we ask Google to send us. We never read the title, description, guests or location of your other events. | To show your Stack19 appointments in your calendar, and to avoid offering a time when you are busy. |

**B. New section "Google Calendar" (after section 5, or as 5A; the Limited Use sentence goes here)**

> If you are an Owner and you choose "Connect Google Calendar", you give Stack19 permission, through Google's own consent screen, to do three things on the calendar you connect: add, change and delete the appointment events that Stack19 itself created (`calendar.events`); ask Google when you are busy, as start and end times only (`calendar.freebusy`); and receive an alert from Google when the calendar changes, so we keep the offered times right. We do not read the titles, descriptions, guests or locations of other events, and we do not change or delete any event we did not create.
>
> We use this data only to provide that booking feature. We do not sell it, share it with anyone, use it for advertising, or use it to train AI models, and the AI assistant is not given your calendar data, only the list of times that are open. Our staff do not read it, except where you ask us to and agree, or it is needed for security, or the law requires it.
>
> Where it is kept: Google's token is kept in Google Secret Manager in Mumbai, India, not in our database. Our database keeps the id of each event we wrote, the details of the alert channel and your Google account's e-mail address. Busy times (start and end only) of the next 60 days are kept while you have "block busy times" on, are replaced every time we check again, and are deleted when you disconnect.
>
> Stack19's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

**C. Addition to Section 4 ("Our assistant is an AI"), one sentence**

> Data we receive from your Google Calendar is not sent to an AI model: the assistant only sees which appointment times are open.

(TODO(C1): true only if the slots list is what reaches the model. Section 4 already says other records are sent to a model provider; this sentence is the carve-out.)

**D. New row in the Section 7 table ("How long we keep it")**

| Data | How long |
|---|---|
| Google Calendar connection | Until you disconnect, or you delete your account, or the workspace is erased. Then the token is deleted from Secret Manager and revoked at Google, and the event ids and alert details are deleted at once. Events already on your Google Calendar stay there; they are yours. [TODO(owner): matches the choice in 2.4] |

**E. Addition to Section 9 ("Your rights, and how to withdraw"), one bullet**

> Google Calendar: in the app, Settings, Integrations, Google Calendar, choose Disconnect. We revoke Stack19's access at Google and delete our copy straight away. You can also remove Stack19's access yourself at any time in your Google Account, under Security, "Third-party apps with account access" (https://myaccount.google.com/permissions); if you do, we stop using the token on the next call and show the connection as lost. To ask us to delete anything else, write to {privacy_email}.

**F. One sentence for the Terms, section "third"**

> If you connect Google Calendar, Google's own terms apply to the calendar, and you must have the right to connect the calendar you choose and to put your customers' first names and appointment times in it.

---

## 5. Demo video script

**Goal (Google's rule):** show how a user starts the connection and grants access, the OAuth consent screen in English with the **app name** and the **OAuth client id in the browser address bar**, and each requested scope **in use** in the app. About 6 to 7 minutes. No voice-over is required, but captions or spoken narration help the reviewer; speak slowly, in English.

**Recording instructions**
- Record the **staging** app, `https://staging.stack19.com`, on a computer, with the **browser address bar always visible** (no full-screen mode that hides it; do not crop it out).
- Browser and Google Account language: **English**. App language: English.
- Use a screen recorder (QuickTime or Loom or the Google Meet recording); 1080p; the cursor visible; zoom the browser to 125% so the address bar and consent text are readable.
- Use the demo workspace (synthetic data only, see `docs/runbooks/demo-workspaces.md`), the owner's own Google test account (listed as a test user, section 6), and a test customer phone or the web chat. Nothing real: no real customer, no real number.
- Use a fresh Google account state: remove Stack19's access first at https://myaccount.google.com/permissions so the consent screen appears in full.
- When the consent screen opens, **pause 3 seconds on the address bar** and click into it or zoom so `client_id=...` and `scope=...` are readable in the URL, and the app name "Stack19" is on the page.
- Upload to YouTube as **Unlisted** (Google requires a link; YouTube Studio > Create > Upload), title "Stack19 Google Calendar OAuth demo", and make sure the link opens without sign-in.
- The same OAuth client id that is in the video must be the one in the project you submit (section 6, "Project and client").
- Staging while the app is in Testing: Google's testing mode expires the refresh token after 7 days (documented by Google). Record on the day you connect; do not rely on an old connection.

| Time | Screen | What to do and say |
|---|---|---|
| 0:00 to 0:20 | Title card, then the browser at `https://staging.stack19.com/login` (address bar visible) | Say: "This is Stack19, an AI assistant for small businesses. This video shows the Google Calendar booking sync and the two Google scopes we request." Log in as the demo workspace owner. |
| 0:20 to 0:45 | Settings > Integrations > Google Calendar (route built in slice 4: **TODO(C1/C2) confirm menu names**), state "Not connected" | Show the notice above the button: what we do, what we never do, the Limited Use sentence and the link to Privacy. Click the privacy link, show that `/privacy` opens and scroll to the Google Calendar section; come back. |
| 0:45 to 1:05 | The Connect button | Say what is asked: "Stack19 asks to add and change its own appointment events, and to see when I am busy." Click **Connect Google Calendar**. |
| 1:05 to 1:50 | **Google's account chooser, then the consent screen** | Choose the test account. On the consent screen: pause. Point to the app name "Stack19", then the address bar: `accounts.google.com/...client_id=<id>...&scope=...calendar.events...calendar.freebusy...`. Read the two permissions aloud as Google words them ("View and edit events on all your calendars", "View your availability in your calendars"). Note aloud that the screen is the unverified-app screen in testing (click Continue). Click **Allow**. |
| 1:50 to 2:10 | Back in Stack19, "Connected" | Show the connected state and the calendar named (Primary). Say: "The token is stored in Google Secret Manager, not in our database." |
| 2:10 to 2:50 | **Scope 1 in use: write.** Open the web chat (or the "book an appointment" form) as a customer and book "Saturday 11:00" | Show the booking confirmation in Stack19 (Appointments list shows it as booked). |
| 2:50 to 3:30 | **Google Calendar** in a second tab, `https://calendar.google.com`, address bar visible | Refresh: the new event appears at Saturday 11:00 with the title and the "Booked through Stack19" line. Open the event: show there are no guests. Say: "This event was created by Stack19 with the calendar.events scope." |
| 3:30 to 4:10 | **Change flows to Google.** In Stack19 reschedule the appointment to 12:00; show the event moved in Google Calendar. Cancel it; show it is gone. | Say: "Stack19 only updates and deletes events it created." Then create a **different** event directly in Google Calendar called "Personal test" and show Stack19 does not touch it. |
| 4:10 to 5:10 | **Scope 2 in use: free/busy.** In Google Calendar create an event "Doctor" (personal, any title) at Saturday 14:00 to 15:00. In Stack19 (as a customer, web chat) ask for appointment times on Saturday. | Show the offered times **skip 14:00 to 15:00**. Say: "Stack19 asked Google only whether I am busy, which returns start and end times without the event title. The customer sees nothing about the Doctor event." If an admin or log view exists, show it holds no title. |
| 5:10 to 5:40 | **Push (`events.watch`)** | Move the "Doctor" event to 16:00 in Google Calendar, wait for the update (the API call to `events.watch`'s channel; **TODO(C1): provide a "last synced" indicator or log line to show on screen**), and show that the customer's list now offers 14:00 and blocks 16:00. |
| 5:40 to 6:20 | **Disconnect** | In Stack19 click **Disconnect**; show the confirm text ("We revoke access at Google and delete our copy"); confirm. Show Stack19 back to "Not connected". Open https://myaccount.google.com/permissions in the address bar and show Stack19 no longer listed. |
| 6:20 to 6:40 | Closing | Show `/privacy` Google Calendar section and the Limited Use sentence once more. Say: "This is everything the two scopes are used for." |

Checks before you upload: the address bar was visible the whole time; the consent screen is in English; the `client_id` is readable; each scope is used on screen (write: 2:10 to 4:10; free/busy: 4:10 to 5:10; watch: 5:10 to 5:40); the disconnect shows the revocation. No real person's data appears.

---

## 6. OAuth consent screen setup checklist

Google renamed the console pages. As of 14 Nov 2026 the page is **Google Cloud console > menu > APIs & Services > OAuth consent screen**, which opens **Google Auth platform** with tabs **Overview, Branding, Audience, Clients, Data Access, Verification Center**. Older projects still show the "Edit app" wizard (User type, App name, ... Scopes, Test users). Use whichever your console shows; the fields are the same.

**Project and client (decision first)**
- **TODO(owner): which Google Cloud project?** Recommended: the same project that already has the Google **sign-in** client `stack19-staging` (see `docs/runbooks/social-sign-up.md`), because the brand is the same and the consent screen is per project, but a **separate OAuth client** "stack19-calendar" (the sign-in client stays untouched; its scopes are only basic sign-in). Write the project id here: ______ . Also write the current publishing status of that consent screen (Testing or In production): ______ .
- Whatever project and client the video shows is the one you submit for verification (a client can hold the staging redirect URI now and the production one later).

| # | Field / step | Value | Done |
|---|---|---|---|
| 1 | Enable the API: APIs & Services > Library > **Google Calendar API** > Enable | | [ ] |
| 2 | **Branding** > App name | `Stack19` (the same name as the website; no "Google" in the name) | [ ] |
| 3 | User support email | `hello@stack19.com` | [ ] |
| 4 | App logo | A square PNG or JPEG, **120 x 120 px**, under 1 MB (Google's rule at the time of writing; verify in the form). Candidate: `apps/web/public/icons/icon-128.png` (128 px, so resize) or `apps/web/public/icons/mark.svg` exported. **TODO(owner): approve the logo.** The logo needs brand verification when you upload it | [ ] |
| 5 | App home page | `https://stack19.com` (public, not a login page, describes the app, links to the privacy page). **TODO(owner): confirm the live home page does** | [ ] |
| 6 | App privacy policy link | `https://stack19.com/privacy`. DRAFT text; **it must say what section 4 says before you submit** | [ ] |
| 7 | App terms of service link | `https://stack19.com/terms` (DRAFT) | [ ] |
| 8 | Authorized domains | `stack19.com` (covers `staging.stack19.com`). Add after Search Console verification (section 9). If you later serve the OAuth callback from an own domain, it must be under this domain | [ ] |
| 9 | Developer contact information | `hello@stack19.com` (use a mailbox you read: all OAuth review e-mail goes to project owners and editors and this address) | [ ] |
| 10 | **Audience** > User type | **External** (Stack19's users are any Google account; Internal means only your own Google Workspace organisation) | [ ] |
| 11 | **Audience** > Publishing status | **Testing** for staging | [ ] |
| 12 | **Audience** > Test users | The owner's Google account(s) (up to 100 allowed). **TODO(owner): the exact address(es)**: ______ | [ ] |
| 13 | **Data Access** > Add or remove scopes | Add exactly the two in section 2 (type each URL into "Manually add scopes"); read the sensitive/restricted label Google shows and write it in 2.2 | [ ] |
| 14 | Scope justification and demo video | Section 2.4, 2.5 and 5; entered in the **Verification Center** when you submit | [ ] |
| 15 | **Clients** > Create client | Application type **Web application**, name `stack19-calendar-staging` | [ ] |
| 16 | Authorized redirect URIs (client) | See below | [ ] |
| 17 | Authorized JavaScript origins | None needed (server-side code flow). Leave empty | [ ] |
| 18 | Download the client secret? | **No file.** Copy the id and secret straight into Secret Manager with the hidden prompt in section 7 step 9; never paste into a chat, a file or the repo | [ ] |

**Redirect URIs**

| Where | URI | Status |
|---|---|---|
| Staging | `https://sme-api-620338396268.asia-south1.run.app/v1/integrations/google-calendar/callback` | **Placeholder path: the route is being built (slice 4)** and may be renamed; the final path is in `docs/contracts/appointments.md` (slice 6). Register the URI Google gets only after C1 confirms the path. **TODO(C1): confirm the path.** |
| Production | `https://<production API host>/v1/integrations/google-calendar/callback` | **TODO(owner): production host**; add later to the same client |

Known risk **(TODO(owner) decide):** `*.run.app` is Google's shared domain, not yours, so you cannot list it under "Authorized domains" (the field takes a domain you own). A staging client in Testing works with it. For **verification** Google may ask that redirect URIs sit on an authorized domain you have verified. If that happens, serve the API (or just this callback) on a stack19.com name (for example an `api.` sub-domain) and register that URI. How is the owner's call and may cost money: Cloud Run domain mappings do not support `asia-south1`; the documented routes are a global load balancer (about USD 18 a month, needs approval) or a Cloudflare Worker forwarding to the `run.app` address (cheaper, needs a cookie test) (`docs/runbooks/hosting-owner-runbook.md`). Note `staging.stack19.com` does **not** forward `/v1` today (`docs/runbooks/whatsapp-staging.md`), so it cannot be used as is. Decide before you record the video, because the redirect URI is on screen.

Before you press "Publish app": Google's rule is that an app still in Testing cannot be submitted; publishing to production while unverified shows users the "unverified app" screen and caps **new** users at 100 for the project's life. Publish only when you submit (section 7).

---

## 7. Steps only the owner can do, in order

| # | Step | Where (menu names) | Notes |
|---|---|---|---|
| 1 | Approve (or have the lawyer approve) the new privacy sentences (4.2) and the logo; tell C1 to put them live. | This repo / the owner | Until approved the pages are DRAFT. |
| 2 | Verify **stack19.com** in Google Search Console (section 9). | https://search.google.com/search-console | Must be done by a project owner or editor of the Cloud project. |
| 3 | Choose the Cloud project and write its id and the current consent screen status in section 6. | Google Cloud console > project picker | Same project as the sign-in client, recommended. |
| 4 | Enable the Google Calendar API. | APIs & Services > Library | |
| 5 | Fill **Branding** (app name, support e-mail, logo, home page, privacy, terms, authorised domain `stack19.com`, developer contact). | Google Auth platform > Branding | Section 6 rows 2 to 9. |
| 6 | Set **Audience**: External, Testing, add your test user(s). | Google Auth platform > Audience | |
| 7 | Add the two scopes; write down the class Google shows. | Google Auth platform > Data Access | If either says "restricted", stop and ask C1. |
| 8 | Create the **Web application** client with the staging redirect URI. | Google Auth platform > Clients > Create client | After C1 confirms the callback path. |
| 9 | Put the client id and secret in **Secret Manager** with a hidden prompt (snippet below). | Google Cloud console > Security > Secret Manager, or the terminal | Names proposed: `sme-google-oauth-client-id`, `sme-google-oauth-client-secret` (**TODO(C1): align with slice 4**). Grant the API's service account `secretAccessor` on those two (the pattern in `docs/runbooks/whatsapp-staging.md`). |
| 10 | Tell C1 "client is ready"; C1 turns the real Google on for staging (until then slice 4 runs on a fake Google). | | Staging only. |
| 11 | Test as the test user on staging; record the video (section 5). Upload to YouTube, Unlisted. | | Remember: in Testing, tokens expire after 7 days. |
| 12 | Publish the privacy, terms and (if changed) the contact pages on **stack19.com** and check them while signed out. | | Public, no login. |
| 13 | **Publish app** (Audience > Publishing status > Publish app). | Google Auth platform > Audience | Only when you are ready to submit. |
| 14 | **Prepare for verification** and fill in: scope justifications (2.4, 2.5), demo video link, "how to use the app" note (section 8, q. 1). | Google Auth platform > Verification Center | Paste the texts; use the button **Submit for verification** at the end. |
| 15 | Watch the mailbox (project owner/editor and the developer contact). Reply to the reviewer within a few days with the section 8 answers. | e-mail | Review of sensitive scopes can take about 10 days or longer, in several rounds. |
| 16 | After approval, add the production redirect URI to the same client, and tell C1 to point production at it. Production stays off until the owner says. | Google Auth platform > Clients | A verified app does not need re-verification for a new redirect URI, but adding a scope does. |

Hidden-prompt snippet (pattern from `docs/runbooks/production-owner-steps.md`; nothing is printed or saved to history):

```
read -rs -p "client id: " V; echo; printf %s "$V" | gcloud secrets create sme-google-oauth-client-id --project <staging project id> --replication-policy=automatic --data-file=-; unset V
read -rs -p "client secret: " V; echo; printf %s "$V" | gcloud secrets create sme-google-oauth-client-secret --project <staging project id> --replication-policy=automatic --data-file=-; unset V
```
(TODO(owner): the staging project id: ______ . If `gcloud secrets create` says a secret exists, use `gcloud secrets versions add <NAME> --data-file=-` instead.)

---

## 8. Likely reviewer questions, and answers

| # | Question | Answer |
|---|---|---|
| 1 | How can we test the app / which account do we sign in with? | Give the reviewer a **demo workspace owner login** on staging (synthetic data) and tell them to connect any Google test account. **TODO(owner): create the reviewer login** (same as the Meta pack: an e-mail with no real person's data, password entered only in Google's form, second factor removed or its secret given). While in Testing, the reviewer's Google account must be on the test-user list; after Publish app it need not be. Steps to give: sign in, Settings > Integrations > Google Calendar > Connect, accept the consent, then book an appointment in the web chat and check the calendar. |
| 2 | Why do you need `calendar.events`? Why not read-only? | To create, update and delete the appointment events Stack19 books for the owner. Read-only cannot write. We read only events we created. (2.4 text.) |
| 3 | Why not `calendar.app.created` (a separate calendar the app owns)? | The owner wants appointments on the calendar they already use, beside their other commitments, and with busy times blocking offered slots. A separate calendar nobody watches defeats the purpose. If Google insists, we can switch to it and accept a second calendar, with free/busy still on the primary. (Owner decides at that point.) |
| 4 | Why not `calendar.events.owned`? | **Answer depends on the decision in 2.3.** If we use `calendar.events`: the connected calendar might be one the user has write access to but does not own (a shared team calendar); `events.owned` would refuse it. If we switch to `events.owned`: say so, and say that v1 writes only to the user's own primary calendar. |
| 5 | Why `calendar.freebusy` and not the events scopes for reading? | `freebusy.query` does not accept `calendar.events`; `calendar.freebusy` is the narrowest scope that answers "is the owner busy". It returns start and end only, not titles. |
| 6 | Do you read other events' titles or details? | No. We never call `events.list` or `events.get` on events we did not create. A push alert carries no event data; on an alert we ask free/busy again. (2.1.) |
| 7 | What does a Google push notification do, and what if the address is down? | Google posts a body-less alert to our HTTPS endpoint with a channel id and token; we check the token, then run `freebusy.query`. Channels expire (default 7 days), and Google does not renew them: a scheduled job renews before expiry with `events.watch` and stops old channels with `channels.stop`. If we miss an alert, the scheduled refresh every 30 minutes queries Google anyway, so a missed alert cannot offer a busy time for long (C1, as built: slots read the stored busy ranges; Google is not called per slot request). |
| 8 | Where are tokens stored? Who can read them? | Google Secret Manager, Mumbai region (asia-south1), not the database; only the API's service account can read them; they never appear in logs, e-mails or chat. Per workspace; deleted at disconnect. |
| 9 | What happens on disconnect? | We call Google's revoke endpoint for the token, stop the push channel, delete the secret and our mapping rows. Events already written stay on the owner's calendar (**TODO(owner): confirm, 2.4**). |
| 10 | Is any Google data sent to an AI model or used to train one? | No. The assistant sees only the list of open times. Google data is not used to develop or train any model. (**TODO(C1): confirm.**) |
| 11 | Who at your company can see calendar data? | Nobody reads it by default. Only the connected business's Owner sees its own appointments in the app. Limited Use exceptions only (3.2). |
| 12 | Do you transfer or sell the data? | No. The only sub-processor involved is Google Cloud (hosting and the secret store), which is covered by the Limited Use statement as the infrastructure we run on. (Check the live sub-processor list.) |
| 13 | Is it used for advertising? | No. No advertising and no analytics anywhere in the app (privacy notice, section 11). |
| 14 | Your privacy policy or homepage does not mention Google data. | Section 4. The new "Google Calendar" section and the Limited Use sentence must be live **before** submitting; confirm by opening `https://stack19.com/privacy` signed out. |
| 15 | The redirect URI domain is not on your authorized domains. | Section 6 risk: switch the callback to a stack19.com host and re-register it. |
| 16 | The demo video does not show X. | Re-record that part only; the checks list at the end of section 5 is the list reviewers use. |
| 17 | Who is the company, where, and who is the contact? | Section 1 table. |
| 18 | Will the user be asked for more scopes later? | No, not without a new consent. Adding a calendar picker later would need `calendar.calendarlist.readonly` and a new review (2.3). |
| 19 | Child users? | The app is for adults and businesses (privacy notice, section 8). |

---

## 9. Domain verification (Google Search Console)

Google requires every authorized domain to be verified by a project owner or editor in Search Console, with the **same Google account** that owns or edits the Cloud project.

1. Open https://search.google.com/search-console and sign in with that account.
2. **Add property** > choose **Domain** (left box, not "URL prefix") > type `stack19.com` > Continue. (A Domain property covers `staging.stack19.com` and every sub-domain, which a URL-prefix property does not.)
3. Google shows a **TXT record** (`google-site-verification=...`). Copy it.
4. Cloudflare (where `stack19.com` DNS lives: see `docs/runbooks/hosting-owner-runbook.md`): open the `stack19.com` zone > **DNS** > **Records** > **Add record**: Type `TXT`, Name `@`, Content = the value from step 3 (keep the quotes Google gave off if Cloudflare adds them), TTL Auto > Save.
5. Back in Search Console press **Verify**. If it says "not found yet", wait a few minutes (DNS can take up to a day) and press Verify again.
6. Leave the TXT record in place permanently (removing it un-verifies the domain).
7. Check the Cloud console: **Google Auth platform > Branding > Authorized domains** shows `stack19.com` without a warning. If the console says it still needs verification, make sure the Cloud project's owner/editor is the Search Console account from step 1.
8. Is it already done? **TODO(owner):** the domain may already be verified if it was used for Google sign-in or Meta business verification; look under Search Console > property list. Write the answer here: ______ .

---

## 10. Sources read (14 Nov 2026), and what this pack could not confirm

- Calendar scopes list and the method pages `events.insert`, `events.watch`, `events.list`, `freebusy.query`, `calendarList.list`: https://developers.google.com/workspace/calendar/api/auth and https://developers.google.com/workspace/calendar/api/v3/reference
- Push notification guide (no body; channels expire; renew by a new `watch`; `channels.stop`): https://developers.google.com/workspace/calendar/api/guides/push
- Verification: https://support.google.com/cloud/answer/13464321 (requirements), https://support.google.com/cloud/answer/13461325 (submitting), https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification (sensitive scopes, demo video, 100-user cap), https://support.google.com/cloud/answer/15549945 (Testing: 100 test users, 7-day token expiry)
- Limited Use: https://developers.google.com/terms/api-services-user-data-policy

Could not confirm from Google's pages: (1) the sensitive/restricted label of each scope (Google shows it only inside the console: step 7 of section 7); (2) the exact logo pixel rule; (3) the review time (Google says "up to 10 days" for sensitive scopes; it often takes longer). Where this pack says "Google's rule" without a link, re-read it on the day.

---

## 11. TODO(owner) list (also repeated in the PR)

1. Confirm the sensitive/restricted label of `calendar.events` and `calendar.freebusy` on the Data Access page (2.2).
2. Decide `calendar.events` vs the narrower `calendar.events.owned` (2.3, question 4).
3. Decide primary-calendar-only in v1 (no calendar picker, no `calendarlist` scope) (2.3).
4. Decide what happens to events already written when the owner disconnects: leave them (default) or delete them (2.4, 4.2-D).
5. Approve or send to the lawyer: the DRAFT privacy sentences 4.2 A to F and the te/hi/kn drafts; decide whether this is a "material change" that bumps `LEGAL_VERSION` and asks for acceptance again (4.1 row 14).
6. Approve the logo (6, row 4).
7. Confirm the homepage (https://stack19.com) describes the app, links to the privacy page and is public (6, row 5).
8. Choose the Cloud project, give its id and the current consent screen status (6).
9. List the test user e-mail(s) (6, row 12).
10. Production API host for the production redirect URI, and whether to move the callback to a stack19.com host (6, "Known risk").
11. Staging Cloud project id for the Secret Manager commands (7).
12. Create the reviewer login on the staging demo workspace (8, question 1).
13. Check whether stack19.com is already verified in Search Console (9, step 8).
14. Do the console steps in section 7, record and upload the video, and submit.

Slice 4 items for C1 (not for the owner): event title text and what goes in the event (2.4); busy ranges stored or not (2.5); never `events.list` (2.1); no Google data in model prompts, logs, Sentry (2.5, 3.2); callback path and the contract (6); secret names (7); "last synced" indicator for the video (5); queries Google at slot time too (8, q. 7); data-inventory, `/data-deletion` and Terms edits (4.1).

## 12. Slice 4 as built (C1's answers to the TODO(C1) items, 14 Nov 2026)

- **Scopes**: exactly `calendar.events` and `calendar.freebusy`; primary calendar only (no calendar list scope, no `openid email`). `events.list` is never called; our own events are read only with `events.get` by the event id WE chose.
- **Event text**: title "Appointment: <first name> <last initial>." ("Appointment" once the person is erased); description = the purpose and the party size only (no phone number, no e-mail address, no address; numbers typed into the purpose are hidden); `sendUpdates=none`, no guests; private extended property `stack19_visit_id`. (The pack's proposed "Booked through Stack19" line and link are NOT in v1: the owner's slice plan asks for purpose and party size only.)
- **Busy ranges**: stored, see 2.5 "Data stored" (one table, 60 days, replaced per refresh). Never in a model prompt: the assistant only sees the open slots the database computes.
- **Second factor**: connecting is an Owner action with the second factor (ADR 0115: asked of an Owner who turned the authenticator on).
- **No Google data in logs or Sentry**: errors are closed code words and class names; the callback's query string is redacted from access logs; tokens are only in Secret Manager (`sme-ws-<workspace>-google_calendar`).
- **Callback path (final)**: `<PUBLIC_BASE_URL>/v1/integrations/google-calendar/callback`; contract `docs/contracts/google-calendar.md`.
- **Secret names (final)**: `sme-google-oauth-client-id`, `sme-google-oauth-client-secret` (written by `scripts/google_oauth_client_register.py`).
- **"Last synced" indicator**: `last_synced_at` in `GET .../integrations/google-calendar/status` (C2 shows it).
- **Disconnect**: events already written stay in the owner's calendar (the owner can reverse this decision).

