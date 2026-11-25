import type { CalendarsPage, Channel, CommerceData, FormTemplate, NotifyPage, ShopConnection } from "@/lib/api/commerce-notify";

/** Sample data for the review page and the tests (nothing is sent or stored). Every invented number starts 9000; every address is a reserved example domain. */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SETTINGS = { confirmOrders: "cod", abandoned: false, abandonedAfterMin: 60, checkoutConsent: false, shareStatus: true } as const;

export const SHOPIFY_CONNECTED: ShopConnection = { id: ID(1), kind: "shopify", storeLabel: "demo-shop.myshopify.com", state: "connected", problem: null, last4: "k3Fq", webhooksRegistered: true, lastEventAt: "2026-11-25T09:30:00Z", settings: { ...SETTINGS, abandoned: true }, abandonedSupported: true, orders30d: 42, cod30d: 31, cartsWaiting: 3 };
export const WOO_PROBLEM: ShopConnection = { id: ID(2), kind: "woocommerce", storeLabel: "shop.example.test", state: "problem", problem: "webhooks_not_registered", last4: "x9Lm", webhooksRegistered: false, lastEventAt: null, settings: { ...SETTINGS }, abandonedSupported: false, orders30d: 0, cod30d: 0, cartsWaiting: 0 };

const kinds: NotifyPage["kinds"] = [
  { id: "slack", name: "Slack", fields: [{ key: "url", label: "Slack incoming webhook address", hint: "Starts with https://hooks.slack.com/services/" }] },
  { id: "telegram", name: "Telegram", fields: [{ key: "token", label: "Bot token", hint: "From @BotFather" }, { key: "chat_id", label: "Chat id", hint: "A number, or @name of a channel" }] },
  { id: "teams", name: "Microsoft Teams", fields: [{ key: "url", label: "Workflows webhook address", hint: "From the Workflows app in Teams" }] },
];
const ch = (kind: Channel["kind"], over: Partial<Channel> = {}): Channel => ({ kind, connected: false, label: "", last4: "", events: [], fields: ["name", "phone_masked", "outcome"], language: "en", testPassed: false, health: { status: "never_sent", reason: null, lastSentAt: null }, sent: 0, failed: 0, rateLimited: 0, ...over });
export const NOTIFY_SAMPLE: NotifyPage = {
  kinds, defaults: ["name", "phone_masked", "outcome"],
  channels: [
    ch("slack", { connected: true, label: "Sales channel", last4: "a1Zq", events: ["new_lead", "missed_call"], testPassed: true, health: { status: "ok", reason: null, lastSentAt: "2026-11-25T09:00:00Z" }, sent: 12, failed: 0, rateLimited: 1 }),
    ch("telegram", { connected: true, label: "Owner chat", last4: "Zk3p", events: ["new_lead"], testPassed: true, health: { status: "problem", reason: "bad_address", lastSentAt: null }, sent: 0, failed: 2 }),
    ch("teams"),
  ],
};

const cal = (kind: CalendarsPage["items"][number]["kind"], name: string, over: Partial<CalendarsPage["items"][number]> = {}): CalendarsPage["items"][number] => ({ kind, name, state: "not_connected", label: "", last4: "", bookingLink: "", shareLink: false, consentQuestion: "", writeEvents: false, blockBusy: false, health: "ok", lastEventAt: null, lastSyncedAt: null, lastError: null, booked: 0, cancelled: 0, needsPerson: 0, ...over });
export const CALENDARS_SAMPLE: CalendarsPage = {
  items: [
    cal("calendly", "Calendly", { state: "connected", label: "Demo Studio", last4: "9aXc", bookingLink: "https://calendly.com/demo-studio/visit", shareLink: true, lastEventAt: "2026-11-24T16:00:00Z", booked: 8, cancelled: 1, needsPerson: 2 }),
    cal("calcom", "Cal.com"),
    cal("outlook", "Outlook / Microsoft 365", { state: "needs_setup" }),
  ],
  needsPerson: [{ id: ID(11), kind: "calendly", reason: "slot", startsAt: "2026-11-27T10:30:00Z" }, { id: ID(12), kind: "calendly", reason: "closed", startsAt: "2026-11-30T11:00:00Z" }],
};

export const FORMS_SAMPLE = [{ id: "typeform", name: "Typeform", group: "forms", channel: "json" }, { id: "tradeindia", name: "TradeIndia", group: "mail", channel: "mail" }];
export const FORM_DETAIL: FormTemplate = {
  id: "typeform", name: "Typeform", group: "forms", channel: "json", docs: ["https://www.typeform.com/developers/webhooks/"],
  steps: ["In Typeform open your form, then Connect, then Webhooks.", "Add this address: https://api.example.test/v1/lead-intake/YOUR-ADDRESS", "Add one yes or no question with the word consent in its name."],
  sample: JSON.stringify({ event_type: "form_response", form_response: { token: "abc123", answers: [{ type: "phone_number", phone_number: "+919000000001" }] } }, null, 2),
  mapping: [["answers[phone_number]", "phone"], ["answers[email]", "email"]], consent: "One yes or no question whose name contains the word consent.", verify: ["The phone_number answer type is not in the webhook page's table."],
};

export function sampleData(): CommerceData {
  return { shops: [SHOPIFY_CONNECTED, WOO_PROBLEM], lists: [{ id: ID(21), name: "Sarees" }], notify: NOTIFY_SAMPLE, calendars: CALENDARS_SAMPLE, forms: FORMS_SAMPLE };
}
