# Meta App Review pack (Stack19 app `1407102551140162`, Tech Provider), prepared 13 Nov 2026

Status: the business is verified; the app is a Tech Provider with the WhatsApp product, test number `+1 555 188 6186`, phone number id `1329673453571780`, WABA `1421890996429034`, Graph API v25.0. **OWNER: submits App Review and creates the System User token** (`docs/runbooks/meta-whatsapp-owner-steps.md`). C1 prepared everything below; the privacy text on the live site is still a DRAFT until the owner approves it (see "Before you submit").

## What Stack19 is (the paragraph Meta's reviewer reads first)
Stack19 is an AI assistant for small businesses in India (shops, coaching centres, builders' suppliers, clinics). A shop connects its own WhatsApp Business number through Embedded Signup. Customers who write to the shop get an answer from the shop's assistant; every message the assistant wants to send that could commit the shop (a price, a promise) waits for the owner's approval; messages to a customer who has not written in the last 24 hours use only an approved template; a customer who writes STOP is never contacted again. The owner sees every conversation in the app and can reply, take over, or switch the assistant off for any chat.

## Permissions requested and why
**`whatsapp_business_messaging`** (send and receive messages on a connected number)
- Use: the shop's assistant replies to customers who message the shop's number, and sends the shop's approved templates (visit reminder, visit confirmation, follow-up, catalogue share, "we tried to call you") to customers who asked for them.
- Why it is needed: without it a connected shop cannot answer a customer on WhatsApp, which is the product's main channel in India.
- Limits we enforce: free-form text only inside the customer's 24-hour window, approved templates outside it; STOP/opt-out in English, Hindi, Telugu, Kannada ends all messages to that customer; quiet hours 21:00 to 09:00 India time; a per-customer daily limit; an owner-controlled global off switch; every message is in the log with who approved it; no marketing to a customer who has not opted in.

**`whatsapp_business_management`** (manage the WhatsApp Business Account of a connected shop)
- Use: read the connected account's phone number and its message templates and their review status; create the shop's templates (the five above, in English, Telugu, Hindi and Kannada, one variable each, no prices or links) and submit them to Meta for review; subscribe our app to the account's webhooks after Embedded Signup.
- Why it is needed: the shop owner should never have to open WhatsApp Manager; Stack19 creates the templates on the shop's own account and shows their approval status in the app.
- We do not use it to read other businesses' data, to change an account's profile without the owner's action, or for anything other than the connected account.

## Embedded Signup (the flow the reviewer should see)
1. The owner opens **Settings > WhatsApp > Connect WhatsApp** in Stack19.
2. Meta's Embedded Signup window opens; the owner logs in with Facebook, picks or creates a WhatsApp Business Account and a phone number, verifies the number.
3. Stack19 receives the WABA id and phone number id, stores them for that business only, subscribes the app to the account's webhooks, and shows "Connected: +91 ..." with the status. Disconnecting removes the link and stops all sending.

## Screen-recording script (about 4 minutes; record the staging app, English UI, no real customer data)
Use the demo workspace "Synthetic Silks" and the Meta test number; say each step aloud or caption it.
1. (0:00) Show the Stack19 login and the Home screen. "This is Stack19; a small shop's assistant."
2. (0:20) Settings > WhatsApp > **Connect WhatsApp**: click it; Embedded Signup opens; choose the test business account and number; finish. The page shows Connected with the number and the webhook subscribed.
3. (1:00) **Receiving**: from a phone, send "Hi, do you have red silk sarees?" to the number. Open **Chats**: the message appears as a new conversation; the assistant's draft reply is shown; a price question shows "Waiting for you" (the money check).
4. (1:50) **Replying inside 24 hours**: the owner approves the reply; it is delivered to the phone; the chat shows sent, delivered, read statuses.
5. (2:20) **Templates**: Settings > WhatsApp > Templates: show the five templates; click Submit for review; show the status (In review / Approved) read back from Meta.
6. (2:50) **Outside the 24-hour window**: show a customer last seen two days ago; the app offers only the approved template; send it.
7. (3:20) **Opt-out**: from the phone send STOP; show the chat marked "Opted out" and a new message attempt being refused with the reason.
8. (3:45) **Control**: switch the assistant off for this chat; show the global "Stop all sending" switch; show the message log with who approved each message.

## Webhook
Callback `https://<production api host>/v1/webhooks/whatsapp` (staging: `https://sme-api-620338396268.asia-south1.run.app/v1/webhooks/whatsapp`); verify token in Secret Manager; every POST is checked with `X-Hub-Signature-256` and the app secret; subscribed field: **messages** (statuses included). Events are stored once per id (replays change nothing).

## Data handling (for the review form)
- Stored: the customer's phone number and name as given, the messages of the conversation, delivery and read statuses, the opt-out; each only for the shop (business) that owns the conversation; encrypted at rest at the database host (Supabase, Mumbai region), access limited by row-level security per business.
- Not stored: nothing is sold or shared for advertising; message content is not used to train models; the AI model sees only the messages needed to reply, with the customer's number removed.
- Retention and deletion: a business can delete a customer's record at any time; deleting the workspace erases all of it; the data-deletion page explains it.

## Links the form asks for
- Privacy policy: `https://stack19.com/privacy` (the page exists in the app at `apps/web/app/(legal)/privacy`; **the text is a DRAFT until the owner approves it**).
- Terms: `https://stack19.com/terms`.
- Data deletion instructions: `https://stack19.com/data-deletion`.
- Business verification: done (13 Nov 2026).
- App icon, category (Business and pages), contact e-mail: the owner's, in App settings > Basic.

## Reviewer access
Give Meta a test login: **OWNER creates one reviewer user in the staging demo workspace** (an e-mail with no real person's data, a password entered only into Meta's form). C1 can create the demo workspace with synthetic data and a second-factor-free reviewer account if the owner asks.

## Before you submit (owner checklist)
1. Approve and publish the privacy policy, terms and data-deletion text on stack19.com (they are drafts: lawyer review pending).
2. Domain verification of `stack19.com` in Business settings.
3. System User token stored (hidden prompt) and the webhook verified.
4. Record the video with the script above; upload it to the review form for each permission.
5. Paste the two permission justifications above into the form.
