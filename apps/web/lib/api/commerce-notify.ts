import { ApiAuthError, ApiContractError, ApiRequestError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bool, int, optInt, optIso, optStr, readRows, rec, str, uuid } from "./shape";

/**
 * The Connectors cards of docs/contracts/commerce-notify.md (C1, 25 Nov 2026): online stores (section B, API flag COMMERCE), messages out to Slack, Telegram and Teams (C, NOTIFY_OUT), calendars (D, CALENDAR_IN) and the lead-form
 * templates (A, LEAD_FORM_TEMPLATES). Each flag is the API's own: it answers 404 while off and the group is then simply not drawn (`null`). SERVER ONLY, with the person's own token. A key is typed into a card and goes to the API ONLY: no
 * answer carries one, so none can be shown again (the one exception, a webhook address or secret the API shows once after a connect, is handed to the card and never kept).
 */
const T = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  return `/v1/tenants/${tenantId}`;
};
const KIND = /^[a-z0-9_]{2,30}$/;
function kindOf(kind: string): string {
  if (!KIND.test(kind)) throw new ApiContractError("kind");
  return kind;
}
const send = (path: string, token: string, method: string, body?: unknown): Promise<unknown> => apiRequest(path, token, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

// ------------------------------------------------------------------------------------------------------------------------------------------ shared closed words
export const STATES = ["connected", "not_connected", "needs_setup", "problem"] as const;
export type State = (typeof STATES)[number];
export const REASONS = [
  "bad_credentials", "no_permission", "unreachable", "not_found", "rate_limited", "webhooks_not_registered", "signature_wrong",
  "store_address_invalid", "credentials_invalid", "secret_required", "slack_url", "telegram_token", "telegram_chat", "teams_url", "teams_legacy", "choices",
  "calendar_key_refused", "calendar_plan_refused", "calendar_link_invalid", "calendar_vendor_unavailable", "calendar_needs_reconnect", "calendar_not_connected", "list_not_products",
  "public_address_missing", "commerce_unavailable", "notify_out_unavailable", "calendar_secret_unavailable", "calendar_no_public_address", "invalid_value",
  "bad_address", "rejected", "timeout", "refused", "tls", "server", "blocked", "no_secret", "redirect",
] as const;
export type Reason = (typeof REASONS)[number];
const reasonOf = (v: unknown): Reason | null => ((REASONS as readonly string[]).includes(v as string) ? (v as Reason) : null);

export type Fail = { ok: false; error: "mfa" | "forbidden" | "unavailable" | "needs_setup" | "invalid" | "soon" | "other"; reason?: Reason };
export function failOf(error: unknown): Fail {
  if (error instanceof ApiAuthError) throw error;
  if (error instanceof ApiRequestError) {
    const r = reasonOf(error.reason) ?? reasonOf(error.code);
    const withReason = (e: Fail["error"]): Fail => ({ ok: false, error: e, ...(r ? { reason: r } : {}) });
    if (error.code === "mfa_required") return { ok: false, error: "mfa" };
    if (error.code === "calendar_needs_setup") return { ok: false, error: "needs_setup" };
    if (["commerce_unavailable", "notify_out_unavailable", "calendar_secret_unavailable", "calendar_no_public_address", "public_address_missing", "calendar_vendor_unavailable"].includes(error.code)) return withReason("unavailable");
    if (["asked_too_soon", "calendar_try_later"].includes(error.code) || error.status === 429) return { ok: false, error: "soon" };
    if (error.status === 403) return { ok: false, error: "forbidden" };
    if (error.status === 422 || error.status === 409) return withReason("invalid");
  }
  return { ok: false, error: "other" };
}
export type Ok<T> = ({ ok: true } & T) | Fail;

/** A group the API does not have (its switch is off): not drawn. Anything else that goes wrong is raised to the page. */
async function optional<R>(go: () => Promise<R>): Promise<R | null> {
  try {
    return await go();
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 503)) return null;
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------ B: stores
export type ShopKind = "shopify" | "woocommerce";
export const CONFIRM_ORDERS = ["cod", "all", "off"] as const;
export type ShopSettings = { confirmOrders: (typeof CONFIRM_ORDERS)[number]; abandoned: boolean; abandonedAfterMin: number; checkoutConsent: boolean; shareStatus: boolean };
export type ShopConnection = { id: string; kind: ShopKind; storeLabel: string; state: "connected" | "problem"; problem: Reason | null; last4: string; webhooksRegistered: boolean; lastEventAt: string | null; settings: ShopSettings; abandonedSupported: boolean; orders30d: number; cod30d: number; cartsWaiting: number };
export type ManualSetup = { address: string; secret: string | null; note: string };
export function parseShop(json: unknown): ShopConnection {
  const x = rec(json, "connection");
  const s = rec(x.settings ?? {}, "settings");
  const c = rec(x.counts ?? {}, "counts");
  const kind = x.kind === "shopify" || x.kind === "woocommerce" ? x.kind : null;
  if (!kind) throw new ApiContractError("kind");
  const confirm = (CONFIRM_ORDERS as readonly string[]).includes(s.confirm_orders as string) ? (s.confirm_orders as ShopSettings["confirmOrders"]) : "cod";
  return {
    id: uuid(x.id, "id"), kind, storeLabel: str(x.store_label, "store_label", 120), state: x.state === "problem" ? "problem" : "connected", problem: reasonOf(x.problem), last4: str(x.secret_last4 ?? "", "secret_last4", 8),
    webhooksRegistered: x.webhooks_registered === true, lastEventAt: optIso(x.last_event_at, "last_event_at"),
    settings: { confirmOrders: confirm, abandoned: s.abandoned === true, abandonedAfterMin: optInt(s.abandoned_after_min, "abandoned_after_min", 15, 1440) ?? 60, checkoutConsent: s.checkout_consent === true, shareStatus: s.share_status !== false },
    abandonedSupported: x.abandoned_supported === true, orders30d: optInt(c.orders_30d, "orders_30d", 0, 10_000_000) ?? 0, cod30d: optInt(c.cod_30d, "cod_30d", 0, 10_000_000) ?? 0, cartsWaiting: optInt(c.carts_waiting, "carts_waiting", 0, 10_000_000) ?? 0,
  };
}
export function parseManual(json: unknown): ManualSetup | null {
  if (json === null || json === undefined) return null;
  const m = rec(json, "manual_setup");
  return { address: str(m.address, "address", 600), secret: optStr(m.secret, "secret", 200), note: str(m.note ?? "", "note", 600) };
}
export type ShopCardData = { connection: ShopConnection; manual: ManualSetup | null };
export const parseShopCard = (json: unknown): ShopCardData => ({ connection: parseShop(json), manual: parseManual(rec(json, "connection").manual_setup) });

export const getShops = async (token: string, t: string): Promise<ShopConnection[]> => readRows(rec(await apiRequest(`${T(t)}/commerce/connections`, token), "connections").items, "items", parseShop, 4);
export type ShopifyInput = { id: string; shop: string; clientSecret: string; accessToken?: string; clientId?: string };
export const connectShopify = async (token: string, t: string, i: ShopifyInput): Promise<ShopCardData> =>
  parseShopCard(await send(`${T(t)}/commerce/connections/shopify`, token, "POST", { id: i.id, shop: i.shop, client_secret: i.clientSecret, ...(i.accessToken ? { access_token: i.accessToken } : {}), ...(i.clientId ? { client_id: i.clientId } : {}) }));
export type WooInput = { id: string; site: string; key: string; secret: string };
export const connectWoo = async (token: string, t: string, i: WooInput): Promise<ShopCardData> => parseShopCard(await send(`${T(t)}/commerce/connections/woocommerce`, token, "POST", { id: i.id, site: i.site, key: i.key, secret: i.secret }));
export type ShopChange = Partial<{ confirm_orders: ShopSettings["confirmOrders"]; abandoned: boolean; abandoned_after_min: number; checkout_consent: boolean; share_status: boolean }>;
const shopPath = (t: string, id: string, tail: string): string => {
  if (!isCanonicalUuid(id)) throw new ApiContractError("connection id");
  return `${T(t)}/commerce/connections/${id}${tail}`;
};
export const changeShop = async (token: string, t: string, id: string, patch: ShopChange): Promise<ShopConnection> => parseShop(await send(shopPath(t, id, "/settings"), token, "PUT", patch));
export const testShop = async (token: string, t: string, id: string): Promise<ShopConnection> => parseShop(await send(shopPath(t, id, "/test"), token, "POST", {}));
export const disconnectShop = async (token: string, t: string, id: string): Promise<void> => {
  await send(shopPath(t, id, "/disconnect"), token, "POST", {});
};

export type ProductsList = { id: string; name: string };
/** The workspace's lists of kind Products (the ones a store can fill). `null` while the lists themselves are off. */
export const getProductLists = async (token: string, t: string): Promise<ProductsList[] | null> =>
  optional(async () => readRows(rec(await apiRequest(`${T(t)}/lists`, token), "lists").lists, "lists", (r) => rec(r, "list"), 20).filter((l) => l.kind === "products").map((l) => ({ id: str(l.id, "id", 64), name: str(l.name, "name", 60) })));
export const NOTE_CODES = ["check_currency", "price_missing", "name_missing", "availability_word_missing", "no_price_column", "variable_products_one_row", "too_many", "partial"] as const;
export type CatalogueRow = { name: string; cells: Record<string, string | number | boolean | null> };
export type Preview = { rows: CatalogueRow[]; notes: { code: string; row: number | null }[]; productsRead: number };
export function parsePreview(json: unknown): Preview {
  const x = rec(json, "preview");
  return {
    rows: readRows(x.rows, "rows", (r) => {
      const o = rec(r, "row");
      const cells: CatalogueRow["cells"] = {};
      for (const [k, v] of Object.entries(rec(o.cells ?? {}, "cells"))) if (/^[a-z][a-z0-9_]{0,29}$/.test(k)) cells[k] = typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) ? v : null;
      return { name: str(o.name, "name", 120), cells };
    }, 1000),
    notes: readRows(x.notes, "notes", (n) => ({ code: str(rec(n, "note").code, "code", 40), row: optInt(rec(n, "note").row, "row", 1, 10_000) }), 200),
    productsRead: int(x.products_read, "products_read", 0, 1_000_000),
  };
}
export const previewCatalogue = async (token: string, t: string, id: string, listId: string): Promise<Preview> => {
  if (!isCanonicalUuid(listId)) throw new ApiContractError("list id");
  return parsePreview(await send(shopPath(t, id, "/catalogue/preview"), token, "POST", { list_id: listId }));
};
export const saveCatalogue = async (token: string, t: string, id: string, listId: string, rows: CatalogueRow[]): Promise<{ created: number; updated: number }> => {
  if (!isCanonicalUuid(listId)) throw new ApiContractError("list id");
  const x = rec(await send(shopPath(t, id, "/catalogue/save"), token, "POST", { list_id: listId, rows }), "saved");
  return { created: int(x.created, "created", 0, 100_000), updated: int(x.updated, "updated", 0, 100_000) };
};

// ------------------------------------------------------------------------------------------------------------------------------------------ C: messages out
export type ChannelKind = "slack" | "telegram" | "teams";
export const NOTIFY_EVENTS = ["new_lead", "missed_call", "call_outcome", "low_balance"] as const;
export const NOTIFY_FIELDS = ["name", "phone_masked", "outcome", "reason"] as const;
export const LANGUAGES = ["en", "te", "hi", "kn"] as const;
export type NotifyField = { key: string; label: string; hint: string };
export type Channel = {
  kind: ChannelKind; connected: boolean; label: string; last4: string; events: string[]; fields: string[]; language: string; testPassed: boolean;
  health: { status: "ok" | "problem" | "never_sent"; reason: Reason | null; lastSentAt: string | null }; sent: number; failed: number; rateLimited: number;
};
export type NotifyPage = { channels: Channel[]; kinds: { id: ChannelKind; name: string; fields: NotifyField[] }[]; defaults: string[] };
function channelKind(v: unknown): ChannelKind {
  if (v === "slack" || v === "telegram" || v === "teams") return v;
  throw new ApiContractError("channel kind");
}
export function parseChannel(json: unknown): Channel {
  const x = rec(json, "channel");
  const h = rec(x.health ?? {}, "health");
  const c = rec(x.counts_24h ?? {}, "counts_24h");
  const status = h.status === "ok" || h.status === "problem" ? h.status : "never_sent";
  return {
    kind: channelKind(x.kind), connected: x.state === "connected", label: str(x.label ?? "", "label", 80), last4: str(x.last4 ?? "", "last4", 8),
    events: readRows(x.events, "events", (e) => str(e, "event", 30), 8), fields: readRows(x.fields, "fields", (e) => str(e, "field", 30), 8), language: (LANGUAGES as readonly string[]).includes(x.language as string) ? (x.language as string) : "en", testPassed: x.test_passed === true,
    health: { status, reason: reasonOf(h.reason), lastSentAt: optIso(h.last_sent_at, "last_sent_at") }, sent: optInt(c.sent, "sent", 0, 10_000_000) ?? 0, failed: optInt(c.failed, "failed", 0, 10_000_000) ?? 0, rateLimited: optInt(c.rate_limited, "rate_limited", 0, 10_000_000) ?? 0,
  };
}
export function parseNotify(json: unknown): NotifyPage {
  const x = rec(json, "channels");
  return {
    channels: readRows(x.items, "items", parseChannel, 3),
    kinds: readRows(x.kinds, "kinds", (k) => {
      const o = rec(k, "kind");
      return { id: channelKind(o.id), name: str(o.name, "name", 40), fields: readRows(o.fields, "fields", (f) => ({ key: str(rec(f, "field").key, "key", 20), label: str(rec(f, "field").label, "label", 80), hint: str(rec(f, "field").hint ?? "", "hint", 300) }), 4) };
    }, 3),
    defaults: readRows(x.fields, "fields", (f) => rec(f, "field"), 8).filter((f) => f.default === true).map((f) => str(f.id, "id", 30)),
  };
}
export const getNotify = async (token: string, t: string): Promise<NotifyPage | null> => optional(async () => parseNotify(await apiRequest(`${T(t)}/notify/channels`, token)));
export type ChannelInput = { label?: string; secrets?: Record<string, string>; events?: string[]; fields?: string[]; language?: string };
export const putChannel = async (token: string, t: string, kind: string, i: ChannelInput): Promise<Channel> =>
  parseChannel(rec(await send(`${T(t)}/notify/channels/${kindOf(kind)}`, token, "PUT", { ...(i.label !== undefined ? { label: i.label } : {}), ...(i.secrets ?? {}), ...(i.events ? { events: i.events } : {}), ...(i.fields ? { fields: i.fields } : {}), ...(i.language ? { language: i.language } : {}) }), "saved").channel);
export type ChannelTest = { ok: boolean; reason: Reason | null; channel: Channel };
export async function testChannel(token: string, t: string, kind: string): Promise<ChannelTest> {
  const x = rec(await send(`${T(t)}/notify/channels/${kindOf(kind)}/test`, token, "POST", {}), "test");
  return { ok: bool(x.ok, "ok"), reason: reasonOf(x.reason), channel: parseChannel(x.channel) };
}
export const disconnectChannel = async (token: string, t: string, kind: string): Promise<void> => {
  await send(`${T(t)}/notify/channels/${kindOf(kind)}/disconnect`, token, "POST", {});
};

// ------------------------------------------------------------------------------------------------------------------------------------------ D: calendars
export type CalendarKind = "calendly" | "calcom" | "outlook";
export type Calendar = {
  kind: CalendarKind; name: string; state: "connected" | "not_connected" | "needs_setup"; label: string; last4: string; bookingLink: string; shareLink: boolean; consentQuestion: string; writeEvents: boolean; blockBusy: boolean;
  health: "ok" | "attention" | "needs_reconnect"; lastEventAt: string | null; lastSyncedAt: string | null; lastError: string | null; booked: number; cancelled: number; needsPerson: number;
};
function calendarKind(v: unknown): CalendarKind {
  if (v === "calendly" || v === "calcom" || v === "outlook") return v;
  throw new ApiContractError("calendar kind");
}
export function parseCalendar(json: unknown): Calendar {
  const x = rec(json, "calendar");
  const c = rec(x.counts_30d ?? {}, "counts_30d");
  const state = x.state === "connected" || x.state === "needs_setup" ? x.state : "not_connected";
  return {
    kind: calendarKind(x.kind), name: str(x.name ?? "", "name", 60), state, label: str(x.label ?? "", "label", 80), last4: str(x.last4 ?? "", "last4", 8), bookingLink: str(x.booking_link ?? "", "booking_link", 300), shareLink: x.share_link === true,
    consentQuestion: str(x.consent_question ?? "", "consent_question", 300), writeEvents: x.write_events === true, blockBusy: x.block_busy === true, health: x.health === "attention" || x.health === "needs_reconnect" ? x.health : "ok",
    lastEventAt: optIso(x.last_event_at, "last_event_at"), lastSyncedAt: optIso(x.last_synced_at, "last_synced_at"), lastError: optStr(x.last_error_code, "last_error_code", 60),
    booked: optInt(c.booked, "booked", 0, 10_000_000) ?? 0, cancelled: optInt(c.cancelled, "cancelled", 0, 10_000_000) ?? 0, needsPerson: optInt(c.needs_person, "needs_person", 0, 10_000_000) ?? 0,
  };
}
export type NeedsPerson = { id: string; kind: string; reason: string; startsAt: string | null };
export type CalendarsPage = { items: Calendar[]; needsPerson: NeedsPerson[] };
export async function getCalendars(token: string, t: string): Promise<CalendarsPage | null> {
  return optional(async () => {
    const items = readRows(rec(await apiRequest(`${T(t)}/calendars/connections`, token), "calendars").items, "items", parseCalendar, 3);
    const needs = await optional(async () => readRows(rec(await apiRequest(`${T(t)}/calendars/bookings/needs-person`, token), "needs").items, "items", (r) => ({ id: uuid(rec(r, "b").id, "id"), kind: str(rec(r, "b").kind, "kind", 20), reason: str(rec(r, "b").reason ?? "", "reason", 20), startsAt: optIso(rec(r, "b").starts_at, "starts_at") }), 20));
    return { items, needsPerson: needs ?? [] };
  });
}
export type CalendarSetup = { webhookUrl: string; secret: string; steps: string[] };
const parseSetup = (v: unknown): CalendarSetup | null => (v === null || v === undefined ? null : { webhookUrl: str(rec(v, "setup").webhook_url, "webhook_url", 600), secret: str(rec(v, "setup").secret, "secret", 200), steps: readRows(rec(v, "setup").steps ?? [], "steps", (s) => str(s, "step", 400), 10) });
export type CalendarSaved = { calendar: Calendar; setup: CalendarSetup | null };
const calendarPath = (t: string, kind: string, tail: string): string => `${T(t)}/calendars/${calendarKind(kind)}${tail}`;
export async function connectCalendly(token: string, t: string, i: { accessToken: string; bookingLink?: string }): Promise<CalendarSaved> {
  const x = rec(await send(`${T(t)}/calendars/calendly/connect`, token, "POST", { access_token: i.accessToken, ...(i.bookingLink ? { booking_link: i.bookingLink } : {}) }), "connect");
  return { calendar: parseCalendar(x.connection), setup: null };
}
export async function connectCalcom(token: string, t: string, i: { bookingLink?: string; label?: string }): Promise<CalendarSaved> {
  const x = rec(await send(`${T(t)}/calendars/calcom/connect`, token, "POST", { ...(i.bookingLink ? { booking_link: i.bookingLink } : {}), ...(i.label ? { label: i.label } : {}) }), "connect");
  return { calendar: parseCalendar(x.connection), setup: parseSetup(x.setup) };
}
export type CalendarChange = Partial<{ booking_link: string; share_link: boolean; consent_question: string; write_events: boolean; block_busy: boolean }>;
export const changeCalendar = async (token: string, t: string, kind: string, patch: CalendarChange): Promise<Calendar> => parseCalendar(rec(await send(calendarPath(t, kind, "/settings"), token, "PUT", patch), "saved").connection);
export const disconnectCalendar = async (token: string, t: string, kind: string): Promise<void> => {
  await send(calendarPath(t, kind, "/disconnect"), token, "POST", {});
};
/** The page the Owner is sent to for Microsoft's consent screen. Only an https address of Microsoft is accepted back (the API makes it; this is a second check before a redirect). */
export async function startOutlook(token: string, t: string): Promise<string> {
  const x = rec(await send(`${T(t)}/calendars/outlook/start`, token, "POST", {}), "start");
  const url = str(x.authorize_url, "authorize_url", 2000);
  if (!/^https:\/\/login\.microsoftonline\.com\//.test(url)) throw new ApiContractError("authorize_url");
  return url;
}

// ------------------------------------------------------------------------------------------------------------------------------------------ A: lead-form templates
export type FormTemplateListing = { id: string; name: string; group: string; channel: string };
export type FormTemplate = FormTemplateListing & { docs: string[]; steps: string[]; sample: string; mapping: [string, string][]; consent: string; verify: string[] };
export const getFormTemplates = async (token: string, t: string): Promise<FormTemplateListing[] | null> =>
  optional(async () => readRows(rec(await apiRequest(`${T(t)}/lead-sources/form-templates`, token), "templates").templates, "templates", (r) => ({ id: str(rec(r, "t").id, "id", 30), name: str(rec(r, "t").name, "name", 60), group: str(rec(r, "t").group, "group", 20), channel: str(rec(r, "t").channel, "channel", 20) }), 20));
export async function getFormTemplate(token: string, t: string, id: string): Promise<FormTemplate> {
  const x = rec(await apiRequest(`${T(t)}/lead-sources/form-templates/${kindOf(id)}`, token), "template");
  return {
    id: str(x.id, "id", 30), name: str(x.name, "name", 60), group: str(x.group, "group", 20), channel: str(x.channel, "channel", 20),
    docs: readRows(x.docs ?? [], "docs", (d) => str(d, "doc", 300), 10).filter((d) => d.startsWith("https://")), steps: readRows(x.steps, "steps", (s) => str(s, "step", 800), 20),
    sample: JSON.stringify(x.sample ?? {}, null, 2).slice(0, 6000), mapping: Object.entries(rec(x.mapping ?? {}, "mapping")).slice(0, 40).map(([a, b]) => [a.slice(0, 80), String(b).slice(0, 40)] as [string, string]),
    consent: str(x.consent ?? "", "consent", 1200), verify: readRows(x.verify ?? [], "verify", (s) => str(s, "verify", 600), 20),
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------------ the page's whole read
export type CommerceData = { shops: ShopConnection[] | null; lists: ProductsList[] | null; notify: NotifyPage | null; calendars: CalendarsPage | null; forms: FormTemplateListing[] | null };
/** Everything the cards need in one read (the page calls it once). A group whose API switch is off is `null` and not drawn. */
export async function loadCommerceData(token: string, tenantId: string): Promise<CommerceData> {
  const [shops, notify, calendars, forms] = await Promise.all([optional(() => getShops(token, tenantId)), getNotify(token, tenantId), getCalendars(token, tenantId), getFormTemplates(token, tenantId)]);
  const lists = shops ? await getProductLists(token, tenantId) : null;
  return { shops, lists, notify, calendars, forms };
}
