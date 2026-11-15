# Meta Lead Ads and Click-to-WhatsApp: what App Review needs (C1, 15 Nov 2026)

Owner, Track D: connect Instagram/Facebook Lead Ads (webhook + leadgen retrieval), test with Meta's Lead Ads Testing Tool, and list the extra permissions for App Review. This file is the list, the design the review will see, and what the owner has to provide. Nothing here has been run against Meta yet: that needs the owner's Meta app and a test Page (secrets by hidden prompt only).

## 1. Where the code stands

* `app/lead_sources/meta.py` and `LeadSourcesService.meta_receive`: the `leadgen` webhook (GET verify, POST with `X-Hub-Signature-256`), the lead fetched from the Graph API (`/{leadgen_id}`, `field_data`) with a Page access token, mapped to a lead (name, phone, email, city, message, `external_id` = the leadgen id), de-duplicated by phone, tag `meta_lead_ads`. Switched off by `META_LEAD_PROVIDER`; a `fake` provider exists for tests.
* TODAY it is ONE app, ONE page token (the operator's, from the environment) and one secret callback address per workspace. That is right for the owner's own test Page and for a pilot business; it is NOT how a product with many businesses connects.

## 2. The design for many businesses (what the review will see)

1. The owner presses "Connect Facebook and Instagram lead ads" on the card: Facebook Login (or Login for Business) with the permissions below, the owner picks the Page(s) the business runs ads on.
2. We store the long-lived **Page access token per workspace** in the workspace secret store (never in a table the API reads back), and subscribe the Page to the app's `leadgen` webhook (`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`).
3. The app has ONE webhook callback address (Meta allows one per app): `/v1/lead-intake/meta`. The event carries `page_id` and `leadgen_id`; we map `page_id` to the workspace, fetch the lead with that workspace's Page token, and the lead goes through the same intake as every other source (tag `meta_lead_ads`, ad / campaign / form name from the lead's `ad_id`, `adset_id`, `campaign_id`, `form_id` when Meta returns them).
4. Status on the card: connected Page name, last lead received, a token that expired or lost the permission -> `needs_attention` with a "Reconnect" button. Disconnect unsubscribes the Page and deletes the token.
5. Test button: a lead created with Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing) for the connected Page, which fires the real webhook; the card turns "waiting" -> "connected" when it arrives (`waiting_for_provider`).

## 3. Permissions and features to request (App Review)

| Permission / feature | Why we need it | Screencast must show |
|---|---|---|
| `leads_retrieval` (Advanced Access) | read the lead's answers after the webhook | a test lead arriving and appearing in the business's Leads |
| `pages_show_list` | let the owner pick the Page | the Page picker after Login |
| `pages_manage_metadata` | subscribe the Page to the `leadgen` webhook | pressing Connect, then the lead arriving |
| `pages_read_engagement` | required with the two above to read the Page's lead forms | (same flow) |
| `pages_manage_ads` | only if we also read which ad / form a lead came from beyond what the lead object carries | (request only if the lead object lacks it) |
| `business_management` | only if the owner's Page is owned through a Business Portfolio | (request only if needed) |
| Business verification of the company | needed for Advanced Access to `leads_retrieval` | the company's documents |
| Data use checklist + privacy policy URL | we store lead contact details | the privacy page (draft until the owner approves) |
| Instagram | Lead Ads on Instagram arrive through the same Page `leadgen` webhook: no extra permission beyond the Page that runs the ads | an Instagram-placement test lead |

Not requested: anything to post, message or read people's own profiles. Data we keep: the lead's own answers and the ad / campaign / form ids; nothing is shared onward; deletion on request follows the product's erasure flow; consent basis "enquired".

## 4. Click-to-WhatsApp ads (no extra Meta permission)

Someone taps an ad that opens WhatsApp and writes to the business. The WhatsApp Cloud API delivers the inbound message with a `referral` object (`source_type: "ad"`, `source_id`, `headline`, `ctwa_clid`, `source_url`). We read it from the inbound webhook we already receive: the lead is created as usual and tagged source "Instagram/Facebook ad" (`click_to_whatsapp`) with the ad's headline and id as the campaign; the reply about their enquiry is allowed (consent basis "enquired"), promotions are not. No App Review item beyond the WhatsApp product the business already uses.

## 5. What the owner has to provide (hidden prompt, nothing in chat)

1. The Meta **App ID and App Secret** of the app that will go through review (staging uses a test app).
2. A **test Page** (and the account that manages it) added as a tester of the app, to run the Lead Ads Testing Tool.
3. The company's business verification documents and the privacy-policy URL (drafts stay drafts until approved).
4. The decision: single-page pilot first (works today once the above are set) or the multi-business login flow (needs the review to pass before any other business can connect).

## 6. Order of work

1. (done) Cards, Test and Disconnect for the website, missed calls and Google Ads.
2. Meta card: states and Test on top of the existing webhook (with the owner's test Page), then the per-workspace Page token, the Page picker and `page_id` routing.
3. Click-to-WhatsApp referral capture in the WhatsApp inbound path.
4. Submit for review with the screencasts of section 3.
