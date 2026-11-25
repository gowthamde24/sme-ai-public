/**
 * The feature flags of the three screens job DM adds before their API exists: the live call, the outcomes (after a call or a WhatsApp follow-up) and Settings > AI assistant. Each is read by the SERVER when it handles a request (not baked into
 * the bundle, like PLAN_SCREENS and lib/auth/signup-open.ts), so a Cloud Run environment variable is enough. Off by default: unset or anything else = off (the screen is not there). "mock" = on with FAKE data that lives in a cookie of the
 * browser (for review and the pictures: no network, nothing stored on a server). "on" = the API of that part, which C1 has not published yet (ADR 0092 and contract-outcomes.md): until it exists the screen says "Not available yet", never a guess.
 */
import { previewMode } from "./preview";

export type ScreenMode = "off" | "on" | "mock";

export function screenMode(value: string | undefined): ScreenMode {
  return value === "mock" ? "mock" : value === "1" ? "on" : "off";
}

export const callScreens = (value: string | undefined = process.env.CALL_SCREENS): ScreenMode => screenMode(value);
/** "Live now": what the assistant is doing at this moment (the pill in the top bar). `1` = the API, `mock` = made-up activity for demo workspaces only. */
export const activityScreens = (value: string | undefined = process.env.ACTIVITY_SCREENS): ScreenMode => screenMode(value);
export const outcomeScreens = (value: string | undefined = process.env.OUTCOME_SCREENS): ScreenMode => screenMode(value);
export const assistantScreens = (value: string | undefined = process.env.ASSISTANT_SCREENS): ScreenMode => screenMode(value);

/** Job DP: the three screens of the night run of 26 Oct, each behind its own flag because C1's APIs ship separately. `mock` = fake data kept in a cookie (nothing is sent), `1` = the API. */
export const callSettingsScreens = (value: string | undefined = process.env.CALL_SETTINGS_SCREENS): ScreenMode => screenMode(value);
export const ownVoiceScreens = (value: string | undefined = process.env.OWN_VOICE_SCREENS): ScreenMode => screenMode(value);
export const marksScreens = (value: string | undefined = process.env.MARKS_SCREENS): ScreenMode => screenMode(value);

/** Job DQ part 2 (DPDP): the settings that need C1's consent and grievance API (the marketing switch, "Raise a grievance", the marketing box of sign-up). `mock` = fake data kept in a cookie (nothing is sent), `1` = the API (contract-dpdp.md). The Privacy notice and its processor list do not depend on it: they are always there. */
export const dpdpScreens = (value: string | undefined = process.env.DPDP_SCREENS): ScreenMode => screenMode(value);

/** Job DQ part 3: the voice picker's samples ("Hear it" beside each voice, per language and tone). `mock` = a short synthetic sound made on the server (no network, no provider: it says which voice is which, not how it will sound), `1` = C1's sample files or preview endpoint through our own route. Off: the buttons are not drawn. */
/**
 * Night 4 (jobs DR and DS), "Lead Desk" and "Ask Vijaya to do it", each behind its own flag because C1's APIs ship separately. `mock` = fake data kept in a cookie (nothing is sent), `1` = the API, unset = the part is not there.
 * LEADS_SCREENS: the nine "any business with leads" types at sign-up, the setup wizard, the knowledge base and playbook, lead imports, lead sources, the Lead Desk list. OUTREACH_SCREENS: batch plans with "Approve all", standing rules,
 * hot-lead hand-offs and the lead report. TASK_SCREENS: "Ask Vijaya to do it". TOPUP_SCREENS: top-ups of minutes and messages in Settings > Plan.
 */
export const leadsScreens = (value: string | undefined = process.env.LEADS_SCREENS): ScreenMode => screenMode(value);
export const outreachScreens = (value: string | undefined = process.env.OUTREACH_SCREENS): ScreenMode => screenMode(value);
/** Offer campaigns and marketing consent (campaigns S3 and S4, 17 Nov): "Who wants offers", the offer form and its approval screen. OFFER_SCREENS=1 shows them (staging); unset = off (production). Nothing here sends anything. */
export const offerScreens = (value: string | undefined = process.env.OFFER_SCREENS): ScreenMode => screenMode(value);
/** JOBS (owner decision 19 Nov 2026, docs: decision-ai-team): jobs on Today, the job pages, and the one design system (round ticks, solid status chips, v2 density, the branded loading). `1` = on (staging first); unset = off (production, and Customer Zero's first weeks). */
export const jobsScreens = (value?: string): ScreenMode => screenMode(value ?? previewMode() ?? process.env.JOBS); // PREVIEW_JOBS (staging only): one browser previews the screens: "1" (the real routes, sample only where a route is 404) for its own business, "mock" for a sample business (lib/screens/preview.ts)
export const taskScreens = (value: string | undefined = process.env.TASK_SCREENS): ScreenMode => screenMode(value);
export const topupScreens = (value: string | undefined = process.env.TOPUP_SCREENS): ScreenMode => (earlyAccess() ? "off" : screenMode(value));

/** Connectors (25 Nov 2026, docs/contracts/crm-push.md): results into the business's own CRM or sheet. `1` = the API (its own switch CRM_PUSH must be on too: the API answers 404 while off, and the page says "not open yet"), `mock` = sample cards for review and pictures (nothing is sent or stored), unset = the page is not there. */
export const crmPushScreens = (value: string | undefined = process.env.CRM_PUSH_SCREENS): ScreenMode => screenMode(value);

export const voiceSampleScreens = (value: string | undefined = process.env.VOICE_SAMPLE_SCREENS): ScreenMode => screenMode(value);

/** Night 5: Settings > AI assistant > "Opening line" (the text of the greeting, with {customer} {assistant} {business} {agent_role}, a voice preview, the "mention that I am an AI assistant" switch, and a per-campaign override). C1's API ships separately (lib/api/opening-line.ts has the assumed contract): `mock` = fake data kept in a cookie (nothing is sent, no sound), `1` = the API, unset = the part is not there. */
export const openingLineScreens = (value: string | undefined = process.env.OPENING_LINE_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Voice" (owner decision 28 Oct, job-voice-picker.md): the approved voices of each language with a recorded sample, and the voice the workspace chooses per language. C1's endpoint (PR 153; lib/api/voice-picker.ts has the contract): `mock` = the approved catalogue with a choice kept in a cookie (the sounds are tones), `1` = the API, unset = the part is not there. */
export const voicePickerScreens = (value: string | undefined = process.env.VOICE_PICKER_SCREENS): ScreenMode => screenMode(value);

/** The guided demo (owner request 28 Oct, job-guided-demo.md): a "Start demo" button in the DEMO workspaces plays a short story over the real screens, with made-up data only. Off unless `1`. */
/** "Start demo call" on Today (owner, 13 Nov 2026; C1's `POST /calls/demo/start` and `/end`, docs/contracts/calls.md): a labelled SIMULATED live call in a DEMO workspace, so the live screens can be tried at any hour. Off unless `1`; the API answers 404 for any workspace that is not a demo one. */
export const demoCall = (value: string | undefined = process.env.DEMO_CALL): boolean => value === "1";

export const guidedDemo = (value: string | undefined = process.env.GUIDED_DEMO): boolean => value === "1";

/**
 * The demo-video mode (job demo-video): a scripted, click-paced story on Today for a screen recording, drawn from fixtures in the browser (nothing is read for it, sent or saved). Reachable only with `?demo=video`, only where this flag
 * is `on` (or `1`), and only for the Owner or an Admin of a workspace the API itself calls a demo one (lib/demo-video/guard.ts). Off unless set.
 */
export const demoVideo = (value: string | undefined = process.env.DEMO_VIDEO): boolean => value === "on" || value === "1";

/** "Talk to your assistant" in the browser (job DV, ADR 0118): the orb becomes a microphone and the assistant answers aloud over a WebSocket to the API. Off unless `1`. */
export const browserVoice = (value: string | undefined = process.env.BROWSER_VOICE): boolean => value === "1";

/** Settings > AI assistant > "About my business" (job context-and-easy-sources part A, contract-context-sources.md): the owner's own notes the assistant uses in chats, calls, Ask and drafts, with "add by paste, file or voice" and "Test it". `mock` = notes kept in the memory of the server (nothing is sent anywhere), `1` = the API (`/ai-assistant/context*`), unset = the part is not there. */
export const aboutBusinessScreens = (value: string | undefined = process.env.ABOUT_BUSINESS_SCREENS): ScreenMode => screenMode(value);

/** Lead sources as big simple cards (job context-and-easy-sources part B, contract-context-sources.md): one clear action and a live status each (Meta, IndiaMART, forwarded e-mails, website, files, WhatsApp, missed calls). `mock` = made-up cards kept in the memory of the server (nothing is sent), `1` = the API (`/lead-sources/cards` and its connect calls), unset = the part is not there. */
export const sourceCardsScreens = (value: string | undefined = process.env.SOURCE_CARDS_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Automatic replies" (job DY, C1's `GET/PUT /ai-assistant/auto-reply`, Owner with the second factor): the switch that lets the assistant answer customers' WhatsApp messages on its own, with the standing rules in plain words and today's counts. `mock` = the switch kept in a cookie of the browser (nothing is sent), `1` = the API, unset = the part is not there. */
export const autoReplyScreens = (value: string | undefined = process.env.AUTO_REPLY_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "Pronunciation" (job pronunciation-quality, owner 30 Oct): the words the assistant must say a certain way (word + "sounds like" + Hear it in the chosen voice), and the "Mispronounced?" action on spoken chat messages. C1's API (`/ai-assistant/pronunciation`, lib/api/pronunciation.ts has the assumed contract): `mock` = the list kept in a cookie of the browser (the sounds are tones), `1` = the API, unset = the part is not there. */
export const pronunciationScreens = (value: string | undefined = process.env.PRONUNCIATION_SCREENS): ScreenMode => screenMode(value);

/** Settings > AI assistant > "How I talk to customers" (calls-like-a-pro part 3, C1's docs/contracts/talk-training.md): the greeting, how to address people, the questions to ask, the words never to say, answers to objections and good examples. The API exists, so there is no made-up mode: `1` = the API, anything else = the part is not there. */
export const talkTrainingScreens = (value: string | undefined = process.env.TALK_TRAINING_SCREENS): boolean => value === "1";

/**
 * "The assistant does the work" (job assistant-does-the-work, C2): files in the chat ("+" > Add a file, drag-and-drop), the work cards (a file's preview, plans with Do it / Change / Cancel and Undo, the secure key box,
 * guided setups with a live test, "can't do yet") and Settings > Activity. C1's API follows its contract docs/contracts/assistant-tools.md: `mock` = made-up answers in the browser and fixtures on the server (no file leaves
 * the page, nothing is stored), `1` = the API through this workspace's own routes, unset = the part is not there (the chat as before).
 */
export function assistantWorkScreens(tenantId: string, value: string | undefined = process.env.ASSISTANT_WORK_SCREENS, tenants: string | undefined = process.env.ASSISTANT_WORK_TENANTS): ScreenMode {
  return assistantWorkTenantListed(tenantId, tenants) ? screenMode(value) : "off";
}

/**
 * ASSISTANT_WORK_TENANTS (C1, 5 Nov; the same meaning in the API): which workspaces get "the assistant does the work", since one web serves every workspace. Unset = every workspace (local, tests);
 * workspace ids separated by ";" or "," = only those (case and spaces do not matter); set but empty, or "none" = no workspace.
 */
export function assistantWorkTenantListed(tenantId: string, tenants: string | undefined): boolean {
  if (tenants === undefined) return true;
  const ids = tenants.split(/[;,]/).map((t) => t.trim().toLowerCase()).filter((t) => t !== "" && t !== "none");
  return ids.includes(tenantId.trim().toLowerCase());
}

/** My AI team v2 (job ai-team-v2, owner 6 Nov 2026; C1's docs/contracts/ai-team.md): the day's shift timeline, the flow strip, the daily stand-up and the helper panel on /ai-team (and the stand-up card on Today). `mock` = the made-up day of
 * lib/api/ai-team-fixtures.ts with the switches kept in a cookie (nothing is sent; the stand-up's sound is a tone), `1` = the API, unset = the page the product had (the helpers' room). */
export const aiTeamScreens = (value: string | undefined = process.env.AI_TEAM_SCREENS): ScreenMode => screenMode(value);
/** The home page's business-number section (landing v2): "KYC done online" and its three KYC steps only once Exotel confirms customers can do the number's KYC online (owner, 6 Nov 2026). Off unless `1`: the section says "Your own business number", with no KYC line. */
export const siteKycCopy = (value: string | undefined = process.env.SITE_KYC_COPY): boolean => value === "1";

/** The home page's trial and GST words (landing v2): "Start 14-day trial", "Two plans. Rupees, GST included." and the trial's terms. Off until the lawyer's review and the GST registration are confirmed (owner, 6 Nov 2026): unset = "Get early access", "Two plans, priced in rupees.", "Free trial at launch. Details when we open." `1` = the later words. */
export const siteTrialCopy = (value: string | undefined = process.env.SITE_TRIAL_COPY): boolean => value === "1";

/** App v4 (job-app-v4.md, owner 6 Nov 2026): the new app, inside the workspace (the five-group menu first, then Today, the customer page and the rest, part by part). On in staging, off in production until the owner says: off unless `1`. */
export const appV4 = (value: string | undefined = process.env.APP_V4): boolean => value === "1";

/** The owner's "Place a test call" screen (job test-call, 10 Nov 2026; C1's `POST /calls/place`, PR #434): Owner only, on the Calls page. It places a REAL phone call to a number on the deployment's test list, so it is off unless `1` (staging only; production never sets it). */
export const testCallScreens = (value: string | undefined = process.env.TEST_CALL_SCREENS): boolean => value === "1";
/**
 * The two plan tiers (owner decision 4 Nov): AI Workforce = every feature, Lead Desk = every feature except the Lead Finder. What the screens read is lib/plan/tier.ts (`GET /billing/entitlements`, C1's draft in
 * docs/contracts/plans-billing.md). Off (unset) = the web treats every workspace as AI Workforce and reads nothing (nothing changes). `mock` = a fixture, AI Workforce unless PLAN_TIER_MOCK=lead_desk (review, tests and pictures:
 * no network). `1` = the API; a missing or odd answer is AI Workforce too, so a tier switch never hides a feature by accident.
 */
export const planTierScreens = (value: string | undefined = process.env.PLAN_TIER_SCREENS): ScreenMode => (earlyAccess() ? "off" : screenMode(value));

/**
 * The Lead Finder's weekly search (job sweep-screens, owner 11 Nov 2026; C1's PROPOSAL docs/contracts/lead-finder-sweep.md, which the API does not have yet): a saved search the scheduler runs once a week, on the Prospects page.
 * `mock` = made-up weekly searches kept in a cookie of the browser (nothing is searched, nothing is sent), `1` = C1's API once it exists, unset = the part is not there. Staging only, with `mock`.
 */
export const sweepScreens = (value: string | undefined = process.env.SWEEP_SCREENS): ScreenMode => screenMode(value);

/**
 * The Tone choice on the owner's "Place a test call" (owner 11 Nov 2026: Respectful, Friendly, Casual). C1 will add a `tone` field to `POST /calls/place`; until it is in the contract (and the API) this stays OFF, because an API that does not know the field
 * refuses it. Off unless `1`; needs TEST_CALL_SCREENS. Turn it on in `deploy/staging-web-flags.env` when C1's contract has the field.
 */
export const testCallTone = (value: string | undefined = process.env.TEST_CALL_TONE): boolean => value === "1";

/**
 * "How your assistant speaks" (owner decision 11 Nov 2026; C1's fixed contract docs/contracts/how-assistant-speaks.md): one panel in Talk training, the same for every business: Tone (Respectful, Friendly; Casual only on an owner test call), Words (everyday with English words, or with fewer),
 * Region (Telugu, Kannada, Tamil) and Introduce as, each with "Hear an example". It replaces "How to address customers". `mock` = made-up, kept in a cookie of the browser (C1's endpoint is built after its contract PR #459; nothing is sent), `1` = C1's `GET/PUT /how-assistant-speaks`
 * once it exists, unset = the part is not there. Needs TALK_TRAINING_SCREENS. NOT in the staging file yet (owner: do not deploy without asking).
 */
export const speaksPanelScreens = (value: string | undefined = process.env.SPEAKS_PANEL_SCREENS): ScreenMode => screenMode(value);

/** More than the four launch languages in the pickers (owner, 13 Nov 2026): Tamil, Malayalam and Marathi. Off unless `1`; a language already in use stays visible either way (lib/languages.ts). */
export const moreLanguages = (value: string | undefined = process.env.MORE_LANGUAGES): boolean => value === "1";

/**
 * "Open in WhatsApp" and "I sent it" on an approved message in the Outbox (owner 13 Nov 2026, job C10; the proposal in `docs-private/plans/open-in-whatsapp-plan.md` section 2 widened to TWO redirect routes: the quote and the outbox message). The button opens the owner's own WhatsApp with the words ready;
 * THIS SYSTEM SENDS NOTHING. "I sent it" marks the message sent by hand (C1's `POST /outbox/messages/{id}/mark-sent`). `mock` = the button works the same, "I sent it" records nothing (staging, until C1's route is on staging), `1` = C1's route, unset = not there (production).
 */
export const outboxWhatsappScreens = (value: string | undefined = process.env.OUTBOX_WHATSAPP): ScreenMode => screenMode(value);

/**
 * The legal pages that are still DRAFTS (owner, 12 Nov 2026: "legal and privacy texts stay drafts until I approve"): today the Refund and Cancellation Policy (/refund-policy). `1` shows them (staging, for the owner to read); anything else = a plain 404, so a draft is never public. The page is never indexed.
 */
export const legalDraftPages = (value: string | undefined = process.env.LEGAL_DRAFT_PAGES): boolean => value === "1";

/**
 * Billing v2 (owner's final pricing, 19 Nov 2026): the Billing page as ONE ₹ wallet with a usage line per feature, optional spending limits, top-up, warnings at 80% and 100%, the upgrade hint and numbers on demand. The paid-plan parts come from Feb 2027, so `mock` shows them as a clear "Preview" with made-up usage (nothing is charged or sent;
 * the state of a scenario is chosen with ?demo=low80|full100|over|upgrade|numbers), `1` = C1's balance route where it exists (lib/api/wallet.ts says which parts are real); anything else = off and the Billing page is exactly what it was. Needs DESIGN_V6.
 */
export const billingV2 = (value?: string): ScreenMode => (earlyAccess() ? "off" : screenMode(value ?? previewMode() ?? process.env.BILLING_V2));

/**
 * Today v5, "quiet Today" (decided by C2, 13 Nov 2026, under the owner's standing rule; the owner can reverse it): what needs the person, the assistant and the day's cards stay in view; the team strip and the totals after calls are folded under ONE line, "More on Today". Off unless `1`; ON in staging.
 */
export const todayV5 = (value: string | undefined = process.env.TODAY_V5): boolean => value === "1";

/**
 * Design system v6 + all pages (owner, 13 Nov 2026, "DESIGN SYSTEM + ALL PAGES"): the new look (warm cream with dots and an orange glow in light, deep brown-black with a fine grid in dark), the new side menu (Today, My assistant, Calls, Chats, Leads, Campaigns, Reports; Setup: Catalogue, Phone numbers, Billing)
 * and the new pages. Off unless `1`; ON in staging, OFF in production until the owner says. Read by the SERVER when it draws the frame (V2Root writes `data-ds="6"`), so no bundle carries it.
 */
export const designV6 = (value: string | undefined = process.env.DESIGN_V6): boolean => value === "1";

/**
 * The rupee balance of a business (owner, 13 Nov 2026: money in ₹, never "credits"; the sidebar's business card says "₹1,550"). `1` = C1's `GET /billing/balance` (billing v2, being built), `mock` = a made-up ₹1,550 (staging until the route exists), unset = no balance shown. Only with DESIGN_V6.
 */
export const balanceScreens = (value: string | undefined = process.env.BALANCE_SCREENS): ScreenMode => (earlyAccess() ? "off" : screenMode(value));

/**
 * The assistant's status for the side menu's "My assistant" badge (Not live / In training / Live) and the Go live / Pause button (owner, 13 Nov 2026; C1's `GET /assistant/status`, `POST /assistant/go-live`, `/pause`, being built). `1` = C1's API, `mock` = a state kept in a cookie of the browser
 * (staging until the API has it), unset = no badge. Only with DESIGN_V6.
 */
export const assistantStatusScreens = (value: string | undefined = process.env.ASSISTANT_STATUS): ScreenMode => screenMode(value);

/**
 * "Teach this" (owner, 13 Nov 2026): a line the assistant said in a call, a chat or a practice is corrected, and the corrected answer is saved into Knowledge, with an undo. `1` = C1's `POST /knowledge/corrections` and `DELETE /knowledge/corrections/{id}` (being built), `mock` = kept in a cookie of the browser
 * (staging until the route exists), unset = no "Teach this" button. Only with DESIGN_V6.
 */
export const teachScreens = (value: string | undefined = process.env.TEACH_SCREENS): ScreenMode => screenMode(value);
/**
 * Settings > Phone number (job B6, ADR 0120; owner 13 Nov 2026): pick a city, a number is reserved, the business's KYC steps run (status only), then the number is active and can ring the owner's phone as a test. `mock` = a TEST screen kept in a cookie of the browser (made-up +00 numbers; nothing is bought,
 * rented or rung), `1` = C1's API once it exists (it does not yet: the part says so), unset = the page as it was ("Not set up yet"). ON as `mock` in staging.
 */
export const phoneNumberScreens = (value: string | undefined = process.env.PHONE_NUMBER_SCREENS): ScreenMode => screenMode(value);

/**
 * The per-chat "Assistant: on/off" switch of the Chats page (owner, 13 Nov 2026). C1 adds `assistant_enabled` to the conversations and a way to change it, in a later change; until then the owner's choice is kept in a cookie of the browser (nothing is sent) and wins over what the API says.
 * `mock` (or `1`) = the switch is drawn and works that way, unset = no switch. Only with DESIGN_V6.
 */
export const chatAssistantSwitch = (value: string | undefined = process.env.CHAT_ASSISTANT_SWITCH): ScreenMode => screenMode(value);

/**
 * The STAFF CONSOLE (owner, 13 Nov 2026; C1's `/v1/admin/*`, docs/contracts/admin-console.md "C1: PHASE 1 IS BUILT"): a separate app area at /staff (its own layout, no shop menu) for Stack19's own staff. `1` = C1's admin API with the signed-in person's session (every call
 * needs the second factor), `mock` = a fixed realistic sample (a saree-shop business set; `?role=owner|support|finance` switches the role) for review while no staff account exists, unset = the area does not exist (a plain 404). ON as `mock` in staging, OFF in production.
 */
export const staffConsole = (value: string | undefined = process.env.STAFF_CONSOLE): ScreenMode => screenMode(value);

/**
 * Settings > Developer API keys (design system v6; owner 13 Nov 2026), TEST mode only: make, rotate and revoke test keys and read the test usage. `1` = C1's `/developer/keys` and `/developer/usage` routes (docs/contracts/developer-api.md), `mock` = a few keys kept in a cookie of the
 * browser (no key works anywhere), unset = the card says "coming soon". A key's secret is shown once, when it is made or rotated, and is never stored or logged here. Only with DESIGN_V6; Owner and Admin.
 */
export const developerKeysScreens = (value: string | undefined = process.env.DEVELOPER_KEYS_SCREENS): ScreenMode => screenMode(value);

/**
 * "How it talks to you" (owner item G, 14 Nov 2026): My assistant > Voice & tone gets a second section, per USER: voice, style, what it calls you, words, speed, each with a short sample. `1` = C1's `/v1/me/talk-prefs`
 * (docs/contracts/owner-talk-prefs.md), `mock` = ONE small cookie of this browser and no sound (staging until the routes are live), unset = no section. Only with DESIGN_V6.
 */
/** The calls-a-day limit card in My assistant > Rules (owner, 14 Nov 2026; C1's `/tasks/call-limit`): off / `1` = the API / `mock` = a test version that keeps the number in a cookie. */
export const callLimitScreens = (value: string | undefined = process.env.CALL_LIMIT_SCREENS): ScreenMode => screenMode(value);
export const ownerTalkPrefs = (value: string | undefined = process.env.OWNER_TALK_PREFS): ScreenMode => screenMode(value);

/**
 * FREE EARLY ACCESS (owner's launch scope, 18 Nov 2026: real businesses sign up and use the full product free; no billing at launch). `1` = nothing in the app asks for money: the Billing menu row is not offered, the balance, the top-ups and the plan tiers are off whatever their own flags say,
 * /billing says "Free during early access", and the site's pricing page says so above the future plans. Unset = the app as it was (staging today). Read by the server at request time.
 */
export const earlyAccess = (value: string | undefined = process.env.EARLY_ACCESS): boolean => value === "1";

/**
 * The Chats composer queue (owner, 19 Nov 2026): the text box is always there; when the 24 hour WhatsApp window is closed the message is QUEUED, the approved hello (`continue_chat`) goes first and the message goes the moment the customer replies (C1's `/conversations/{lead}/queued-message`,
 * contracts/composer-queue-DRAFT.md). `1` = C1's routes, `mock` = made-up answers kept in a cookie of the browser (nothing is sent; texts with a `#` word walk through every state, see lib/api/chat-queue.ts), unset = the old behaviour (the template picker), unchanged. Only with DESIGN_V6.
 */
export const chatQueueScreens = (value: string | undefined = process.env.CHAT_QUEUE_SCREENS): ScreenMode => screenMode(value);

/** First run by business type (owner, 25 Nov 2026: the first-run steps asked for a saree whatever the business): a workspace made without a type is asked "What kind of business?" once, on Get started, and the answer is saved with PUT /pack (C1's first-run contract). `1` = on; unset = the page as it was (404 for such a workspace). */
export const firstRunType = (value: string | undefined = process.env.FIRST_RUN_TYPE): boolean => value === "1";
/** My assistant in the OPEN layout (owner chose it, 24 Nov 2026; mock "My assistant" in stack19-app-mock.html): two tabs, "To your customers" and "To you", the cards as plain hairline sections, the extra choices under "More choices". `1` = on; unset = the screen as it was. */
export const myAssistantOpen = (value: string | undefined = process.env.MY_ASSISTANT_OPEN): boolean => value === "1";

/** The number picker (owner, 28 Nov 2026; mock "Phone numbers"; C1's contract note): the owner picks their own business number from a list (type, "starts with", numbers as radio rows, "Use this number"), then "ready in a minute", then the shop-number forwarding codes. `mock` = made-up numbers and a cookie (staging: nothing is bought); `1` = C1's routes (not live yet: C1 builds the buying side after a read-only probe); unset = the page as it was. Only with DESIGN_V6. */
export const phonePicker = (value: string | undefined = process.env.PHONE_PICKER): ScreenMode => screenMode(value);
/** Settings and Team without sentences (owner, 25 Nov 2026; mock "Settings"): plain labelled fields (label above, one grey hint), one Save with "You have unsaved changes." / "Saved.", the invite as plain fields. `1` = on; unset = the sentence forms as they were. Only with JOBS. */
export const settingsOpen = (value: string | undefined = process.env.SETTINGS_OPEN): boolean => value === "1";
/** Today in the open look (owner, 25 Nov 2026; mock Today + Jobs): "Running now" as open rows with bare category-coloured line icons and a green switch, "Needs you" rows with bare icons and ONE orange action (the second action a grey link), the empty side boxes as one grey sentence. `1` = on; unset = as it was. Only with DESIGN_V6. */
export const todayOpen = (value: string | undefined = process.env.TODAY_OPEN): boolean => value === "1";
/** The First day page in the open layout (owner, 25 Nov 2026; mock "First day"): one title, one sentence, "Skip for now", a thin progress line, the seven steps as hairline rows with ONE orange Start, a plain line with the small orb, a grey help line: no ring, no cards, no gradient, no Go live until the last step. `1` = on; unset = the boxed day one as it was. */
export const firstDayOpen = (value: string | undefined = process.env.FIRST_DAY_OPEN): boolean => value === "1";

/** Chats > Messages we send as plain rows (owner, 25 Nov 2026; mock "Chats"): a plain name, the languages, one status in words (Not sent yet / Waiting for WhatsApp / Approved), ONE "Send all for approval". `1` = on; unset = the table with technical names. */
export const templatesPlain = (value: string | undefined = process.env.TEMPLATES_PLAIN): boolean => value === "1";

/** Filters without sentences (owner, 25 Nov 2026: 'Show [ ] calls from [ ]' is gone everywhere): a bar of labelled outlined dropdowns + the search box + a quiet 'N shown', no card around it, no 'More choices' box. Calls, Leads, Reports, Catalogue. `1` = on; unset = the sentence filters as they were. */
export const filtersOpen = (value: string | undefined = process.env.FILTERS_OPEN): boolean => value === "1";

/** Calls as a list (owner, 25 Nov 2026; mock "Calls"): who (with in/out in grey), what happened in one sentence, when; no column headings, no cost or duration in the list (they are in the detail), a badge only for an exception, no sentence for an unclear result. `1` = on; unset = the table. */
export const callsOpen = (value: string | undefined = process.env.CALLS_OPEN): boolean => value === "1";

/** Leads as an open list (owner, 25 Nov 2026; mock "Leads"): hairline rows (no card per row), names in ink (orange is only "needs you"), the normal "New" state without a pill. `1` = on; unset = the card rows. */
export const leadsOpen = (value: string | undefined = process.env.LEADS_OPEN): boolean => value === "1";

/** Reports as one calm page (owner, 25 Nov 2026; mock "Reports"): the period dropdown, THREE numbers (enquiries, visits, sales), one plain sentence, ONE chart, and 'More reports' (sources, funnel, busiest times, sales line) folded under it. `1` = on; unset = the eight widgets. */
export const reportsOpen = (value: string | undefined = process.env.REPORTS_OPEN): boolean => value === "1";

/** The industry pages (/for/<industry>: textiles, clinics, coaching centres, real estate, car dealers, wholesale), English only. Off = the address is a 404 and the sitemap does not list it. `1` = on. */
export const industryPages = (value: string | undefined = process.env.INDUSTRY_PAGES): boolean => value === "1";

/** The call rules, outreach rules, assistant name and developer keys as plain labelled fields (owner, 25 Nov / 29 Nov 2026: no fill-in-the-blank sentences): the JOBS sentence look draws only when SETTINGS_OPEN is off. */
export const sentenceForms = (): boolean => jobsScreens() !== "off" && !settingsOpen();

/**
 * "What you sell" as named lists (owner's idea, 29 Nov 2026; C1's contract docs/contracts/sell-lists.md): the page shows the owner's lists as cards, a list is a table with columns the owner shapes. `1` = on (the API's own flag WHAT_YOU_SELL_LISTS must be on too: its routes
 * answer 404 while it is off), anything else = the page as it was. Off in production until the planner's run.
 */
export const whatYouSellLists = (value: string | undefined = process.env.WHAT_YOU_SELL_LISTS): boolean => value === "1";

/**
 * Credits and billing on C1's top-up routes (29 Nov 2026; docs/contracts/credits-topup.md): the balance with the minutes it covers, Add credits through Razorpay Checkout (the faked payment on staging), the low-balance line, the statement and the GST invoices. `1` = on (the API's own
 * PRICING_V2 must be on too: its routes answer 404 while it is off); anything else = the Billing page as it was. Off in production until the planner's run and the owner's Razorpay keys.
 */
export const creditsScreens = (value: string | undefined = process.env.CREDITS_SCREENS): boolean => value === "1";

/** The calls panel (owner, 29 Nov 2026; mock "Calls", "Phone numbers", "Credits and billing"; Outpero study): "Before you start calling" (five plain rules, open on Calls, closed on Lead sources), "Hear it yourself" (a test call in the browser, through BROWSER_VOICE), and "How calls are billed" under Credits and billing. `1` = on; unset = off (production until the owner says). */
export const callsPanel = (value: string | undefined = process.env.CALLS_PANEL): boolean => value === "1";
/** "Calls at once" on the Phone numbers page (same mock): how many calls can run together and how many do, from C1's `GET /v1/tenants/{t}/phone-lines` (docs/contracts/calls.md). `mock` = a made-up two-line answer (nothing is read), `1` = the API, unset = the card is not there. Only with CALLS_PANEL. */
export const phoneLinesScreens = (value: string | undefined = process.env.PHONE_LINES_SCREENS): ScreenMode => screenMode(value);

/**
 * "Tell your assistant what to do" on Jobs (owner, 29 Nov 2026; mock "Tell your assistant what to do"; C1's `POST /jobs/describe`, docs/contracts/jobs-describe.md): the owner writes or says the job in their own words, a mode and a language, and sees a DRAFT as plain
 * labelled fields (Name, Who, When, What it does, Language, what it asks first, calling hours) before anything is switched on; "Looks right? Turn it on" uses the normal job start and the normal job change. Needs JOBS too. `mock` = a made-up reading kept in
 * the server (nothing is sent to the model, nothing is stored), `1` = the API, unset = the part is not there (production).
 */
export const tellScreens = (value: string | undefined = process.env.TELL_SCREENS): ScreenMode => screenMode(value);
/**
 * Phone numbers with the business's OWN account (Model B; C1's docs/contracts/business-kyc.md, the API flag KYC_PER_CLIENT): with PHONE_PICKER on too, "Get a phone number" is four steps in one page (Choose a number, Your calling account, Verification, How you will use
 * this number) and "Verify your business" is a status page with the steps and "Start verification". `mock` = a made-up status kept in a cookie (nothing is sent, no document leaves the page), `1` = C1's `/phone-kyc/business` routes, unset = the three-step picker as it was.
 */
export const kycPerClient = (value: string | undefined = process.env.KYC_PER_CLIENT): ScreenMode => screenMode(value);
