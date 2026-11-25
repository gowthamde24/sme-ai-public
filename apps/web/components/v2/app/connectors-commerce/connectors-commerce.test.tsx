import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import app from "@/i18n/strings/app.json";
import { NOTIFY_EVENTS, NOTIFY_FIELDS, NOTE_CODES, REASONS, parseCalendar, parseChannel, parseShop, type CommerceData } from "@/lib/api/commerce-notify";
import { CALENDARS_SAMPLE, FORM_DETAIL, NOTIFY_SAMPLE, SHOPIFY_CONNECTED, WOO_PROBLEM, sampleData } from "@/lib/commerce-notify/sample";

import type { CommerceActions } from "./actions";
import { CommerceConnectors } from "./CommerceConnectors";

afterEach(cleanup);
const wordsOf = (lang: "en" | "te" | "hi" | "kn") => Object.fromEntries(Object.entries(appDict(lang) as Record<string, string>).filter(([k]) => k.startsWith("cn.")));
const words = wordsOf("en");
const fail = async () => ({ ok: false as const, error: "other" as const });
const actions = (over: Partial<CommerceActions> = {}): CommerceActions => ({
  connectShopify: vi.fn(fail), connectWoo: vi.fn(fail), changeShop: vi.fn(fail), testShop: vi.fn(fail), disconnectShop: vi.fn(fail), previewCatalogue: vi.fn(fail), saveCatalogue: vi.fn(fail),
  putChannel: vi.fn(fail), testChannel: vi.fn(fail), disconnectChannel: vi.fn(fail), connectCalendly: vi.fn(fail), connectCalcom: vi.fn(fail), changeCalendar: vi.fn(fail), disconnectCalendar: vi.fn(fail),
  startOutlook: vi.fn(fail), formTemplate: vi.fn(fail), ...over,
});
const mount = (data: CommerceData = sampleData(), a: CommerceActions = actions(), extra: { readOnly?: boolean; w?: Record<string, string>; outlookResult?: string | null } = {}) =>
  render(<CommerceConnectors words={extra.w ?? words} ui="en" data={data} actions={a} readOnly={extra.readOnly} outlookResult={extra.outlookResult} />);
const card = (id: string) => {
  const el = document.querySelector(`[data-part="commerce-card"][data-id="${id}"]`);
  if (!el) throw new Error(`no card ${id}`);
  return within(el as HTMLElement);
};
const open = (id: string) => fireEvent.click(card(id).getByRole("button", { name: "Open" }));

// ============================================================================ the words
describe("the words (prefix cn.)", () => {
  const dict = app as Record<string, { en: string; te: string; hi: string; kn: string; status: Record<string, string> }>;
  const own = Object.keys(dict).filter((k) => k.startsWith("cn."));
  it("every key a card names exists in all four languages, and every family has all its members", () => {
    const dir = path.join(process.cwd(), "components/v2/app/connectors-commerce");
    const files = fs.readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f));
    const literal = /\bt\(\s*["'`](cn\.[\w.]+)["'`]/g;
    const used = new Set<string>();
    for (const f of files) for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(literal)) used.add(m[1]);
    // keys chosen by a ternary or built from a closed word
    const families: string[] = [
      ...REASONS.map((r) => `cn.reason.${r}`), ...NOTE_CODES.map((c) => `cn.note.${c}`), ...NOTIFY_EVENTS.map((e) => `cn.ev.${e}`), ...NOTIFY_FIELDS.map((f) => `cn.nf.${f}`),
      ...["no_lead", "closed", "slot", "full", "past", "other"].map((r) => `cn.np.${r}`), ...["connected", "denied", "expired", "missing_scope", "error", "invalid", "needs_setup"].map((r) => `cn.outlook.back.${r}`),
      ...["mfa", "forbidden", "unavailable", "needs_setup", "invalid", "soon", "other"].map((r) => `cn.fail.${r}`), ...["cod", "all", "off"].map((o) => `cn.shop.confirm.${o}`),
      ...["connected", "not", "setup", "problem"].map((s) => `cn.state.${s}`), ...["name", "price", "stock"].map((c) => `cn.cat.col.${c}`), "cn.form.web", "cn.form.mail", "cn.notify.slack.how", "cn.notify.telegram.how", "cn.notify.teams.how", "cn.cal.calendly.how", "cn.cal.calcom.how",
      ...[1, 2, 3, 4].flatMap((i) => [`cn.shop.shopify.step.${i}`, `cn.shop.woocommerce.step.${i}`]),
    ];
    const missing = [...used, ...families].filter((k) => !dict[k]);
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });
  it("all four languages are filled, Telugu, Hindi and Kannada are drafts in their own script with the same placeholders", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of own) for (const l of ["te", "hi", "kn"] as const) {
      expect(dict[k][l].trim().length, `${l}:${k}`).toBeGreaterThan(0);
      expect(script[l].test(dict[k][l]), `${l}:${k} is in its own script`).toBe(true);
      expect(ph(dict[k][l]), `${l}:${k}`).toBe(ph(dict[k].en));
      expect(dict[k].status[l], `${l}:${k} waits for a reader`).toMatch(l === "te" ? /^(draft|reviewed)$/ : /^draft$/); // Telugu: approved by the owner, 26 Nov 2026
    }
  });
  it("Telugu says అనుమతి for permission and never the bookish words", () => {
    for (const k of own) expect(/కన్సెంట్|విచారణ|సందేశం/.test(dict[k].te), k).toBe(false);
    expect(dict["cn.shop.consent"].te).toContain("అనుమతి");
  });
});

// ============================================================================ the cards
describe("the cards", () => {
  it("draws every group and every card in the right state", () => {
    mount();
    const states = Object.fromEntries([...document.querySelectorAll('[data-part="commerce-card"]')].map((el) => [`${el.getAttribute("data-group")}:${el.getAttribute("data-id")}`, el.getAttribute("data-state")]));
    expect(states).toMatchObject({ "shops:shopify": "connected", "shops:woocommerce": "problem", "notify:slack": "connected", "notify:telegram": "problem", "notify:teams": "not_connected", "calendars:calendly": "connected", "calendars:calcom": "not_connected", "calendars:outlook": "needs_setup", "forms:typeform": "not_connected" });
    expect(card("outlook").getByText("Needs setup by us")).toBeInTheDocument();
    expect(card("teams").getByText("Not connected")).toBeInTheDocument();
    expect(card("shopify").getByText("Connected")).toBeInTheDocument();
    expect(card("woocommerce").getByText("Needs your attention")).toBeInTheDocument();
  });
  it("a group whose API is off is not drawn, and with all four off nothing is", () => {
    const { container, rerender } = mount({ ...sampleData(), shops: null, lists: null, notify: null });
    expect(container.querySelector('[data-group="shops"]')).toBeNull();
    expect(container.querySelector('[data-group="notify"]')).toBeNull();
    expect(container.querySelector('[data-group="calendars"]')).not.toBeNull();
    rerender(<CommerceConnectors words={words} ui="en" actions={actions()} data={{ shops: null, lists: null, notify: null, calendars: null, forms: null }} />);
    expect(container.innerHTML).toBe("");
  });
  it("the review sample says nothing is sent and switches every button off that would change something", () => {
    mount(sampleData(), actions(), { readOnly: true });
    expect(screen.getByText("Sample cards: nothing is sent or saved.")).toBeInTheDocument();
    open("teams");
    expect(card("teams").getByRole("button", { name: "Connect" })).toBeDisabled();
  });
  it("each opened card has at most one orange main button, and no sentence has an input inside it", () => {
    mount();
    for (const id of ["shopify", "woocommerce", "slack", "telegram", "teams", "calendly", "calcom", "outlook", "typeform"]) {
      open(id); // one card is open at a time: opening the next closes the one before
      const el = document.querySelector(`[data-part="commerce-card"][data-id="${id}"]`) as HTMLElement;
      expect(el.querySelector('[data-part="card-panel"]'), id).not.toBeNull();
      expect(el.querySelectorAll("button.write-ctl").length, id).toBeLessThanOrEqual(1);
      expect(el.querySelectorAll("p input, p select, p textarea, span input, span select").length, id).toBe(0);
      for (const label of el.querySelectorAll("label")) expect(label.querySelectorAll("input[type=text], input[type=password], input[type=number], select, textarea").length, `${id}: ${label.textContent}`).toBe(0);
    }
  });
  it("no secret of the sample is ever drawn (only the last four characters, as a hint)", () => {
    mount();
    const seen: string[] = [];
    for (const id of ["shopify", "slack", "calendly"]) {
      open(id);
      seen.push(document.body.textContent ?? "");
    }
    for (const text of seen) expect(text).not.toMatch(/shpat_|whsec_|hooks\.slack\.com\/services\/T|bot[0-9]{6,}:/);
    expect(seen[0]).toContain("k3Fq");
    expect(seen[1]).toContain("a1Zq");
  });
});

describe("Shopify and WooCommerce", () => {
  it("a key is typed into a password field, sent once and cleared; the new card says connected", async () => {
    const connected = { card: { connection: SHOPIFY_CONNECTED, manual: null } };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const connectShopify = vi.fn(async (_input: unknown) => ({ ok: true as const, ...connected }));
    mount({ ...sampleData(), shops: [] }, actions({ connectShopify }));
    open("shopify");
    const secret = card("shopify").getByLabelText("Client secret (API secret key)") as HTMLInputElement;
    expect(secret.type).toBe("password");
    const connect = card("shopify").getByRole("button", { name: "Connect" });
    expect(connect).toBeDisabled();
    fireEvent.change(card("shopify").getByLabelText("Store address"), { target: { value: "demo-shop.myshopify.com" } });
    fireEvent.change(secret, { target: { value: "shpss_signing_secret" } });
    fireEvent.change(card("shopify").getByLabelText("Admin API access token"), { target: { value: "shpat_demo_token_1234" } });
    fireEvent.change(card("shopify").getByLabelText("Client id"), { target: { value: "client-1" } });
    expect(connect).toBeDisabled(); // the token and the client id together are not allowed
    fireEvent.change(card("shopify").getByLabelText("Client id"), { target: { value: "" } });
    fireEvent.click(connect);
    await waitFor(() => expect(connectShopify).toHaveBeenCalledTimes(1));
    expect(connectShopify.mock.calls[0]?.[0]).toMatchObject({ shop: "demo-shop.myshopify.com", clientSecret: "shpss_signing_secret", accessToken: "shpat_demo_token_1234" });
    expect(await card("shopify").findByText("Connected. Orders from this store now reach you.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("shpss_signing_secret");
    expect(document.body.textContent).not.toContain("shpat_demo_token_1234");
  });
  it("when the webhooks could not be added the address and the secret are shown once, then gone", async () => {
    const manual = { address: "https://api.example.test/v1/webhooks/commerce/woocommerce/abcdefghijklmnopqrstuvwx", secret: "Zk3pSecretOnlyShownNow", note: "x" };
    const connectWoo = vi.fn(async () => ({ ok: true as const, card: { connection: WOO_PROBLEM, manual } }));
    mount({ ...sampleData(), shops: [] }, actions({ connectWoo }));
    open("woocommerce");
    fireEvent.change(card("woocommerce").getByLabelText("Shop address"), { target: { value: "https://shop.example.test" } });
    fireEvent.change(card("woocommerce").getByLabelText("Consumer key"), { target: { value: "ck_demo_key_1234" } });
    fireEvent.change(card("woocommerce").getByLabelText("Consumer secret"), { target: { value: "cs_demo_secret_5678" } });
    fireEvent.click(card("woocommerce").getByRole("button", { name: "Connect" }));
    expect(await card("woocommerce").findByDisplayValue(manual.secret)).toBeInTheDocument();
    expect(card("woocommerce").getByText("Shown only now. Copy it before you close this.")).toBeInTheDocument();
    fireEvent.click(card("woocommerce").getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByDisplayValue(manual.secret)).toBeNull();
    expect(document.body.textContent).not.toContain(manual.secret);
  });
  it("a refusal is one plain sentence of the closed reason, never the store's words", async () => {
    const connectWoo = vi.fn(async () => ({ ok: false as const, error: "invalid" as const, reason: "bad_credentials" as const }));
    mount({ ...sampleData(), shops: [] }, actions({ connectWoo }));
    open("woocommerce");
    fireEvent.change(card("woocommerce").getByLabelText("Shop address"), { target: { value: "https://shop.example.test" } });
    fireEvent.change(card("woocommerce").getByLabelText("Consumer key"), { target: { value: "ck_demo_key_1234" } });
    fireEvent.change(card("woocommerce").getByLabelText("Consumer secret"), { target: { value: "cs_demo_secret_5678" } });
    fireEvent.click(card("woocommerce").getByRole("button", { name: "Connect" }));
    expect(await card("woocommerce").findByRole("alert")).toHaveTextContent("The store did not accept these keys. Check them and try again.");
  });
  it("choices are plain labelled controls; saving sends only what changed", async () => {
    const changeShop = vi.fn(async () => ({ ok: true as const, connection: { ...SHOPIFY_CONNECTED, settings: { ...SHOPIFY_CONNECTED.settings, confirmOrders: "all" as const } } }));
    mount(sampleData(), actions({ changeShop }));
    open("shopify");
    const save = card("shopify").getByRole("button", { name: "Save choices" });
    expect(save).toBeDisabled();
    fireEvent.change(card("shopify").getByLabelText("Orders to confirm"), { target: { value: "all" } });
    expect(card("shopify").getByLabelText(/My checkout asks customers to agree/)).not.toBeChecked();
    fireEvent.click(save);
    await waitFor(() => expect(changeShop).toHaveBeenCalledWith(SHOPIFY_CONNECTED.id, { confirm_orders: "all" }));
    expect(await card("shopify").findByText("Saved.")).toBeInTheDocument();
  });
  it("WooCommerce has no cart call-back and says why", () => {
    mount();
    open("woocommerce");
    expect(card("woocommerce").getByText(/does not report left carts/)).toBeInTheDocument();
    expect(card("woocommerce").queryByLabelText(/Call back shoppers/)).toBeNull();
  });
  it("fills a list from the store: preview first, then save only what is kept; an Admin who may not set prices is told plainly", async () => {
    const preview = { rows: [{ name: "Silk saree", cells: { price: 129900, availability: "In stock" } }, { name: "Kurta", cells: { price: 49900, availability: "Few left" } }], notes: [{ code: "check_currency", row: null }], productsRead: 2 };
    const previewCatalogue = vi.fn(async () => ({ ok: true as const, preview }));
    const saveCatalogue = vi.fn(async () => ({ ok: false as const, error: "forbidden" as const }));
    mount(sampleData(), actions({ previewCatalogue, saveCatalogue }));
    open("shopify");
    expect(saveCatalogue).not.toHaveBeenCalled();
    fireEvent.click(card("shopify").getByRole("button", { name: "Show what would be added" }));
    expect(await card("shopify").findByText("Silk saree")).toBeInTheDocument();
    expect(card("shopify").getByText("₹1,299")).toBeInTheDocument();
    expect(card("shopify").getByText("Prices are taken as rupees. Look at them before you save.")).toBeInTheDocument();
    fireEvent.click(card("shopify").getByRole("checkbox", { name: "Add Kurta" }));
    fireEvent.click(card("shopify").getByRole("button", { name: "Save these items" }));
    await waitFor(() => expect(saveCatalogue).toHaveBeenCalledWith(SHOPIFY_CONNECTED.id, expect.any(String), [preview.rows[0]]));
    expect(await card("shopify").findByRole("alert")).toHaveTextContent("Only an Owner or an Admin can do this.");
    expect(card("shopify").getByText(/Only the Owner can save prices/)).toBeInTheDocument();
  });
  it("with no Products list it points to What you sell", () => {
    mount({ ...sampleData(), lists: [] });
    open("shopify");
    expect(card("shopify").getByText(/no list of products yet/)).toBeInTheDocument();
  });
});

describe("messages out", () => {
  it("connects Slack with a password field, clears it, and shows only the last four characters", async () => {
    const connected = parseChannel({ kind: "teams", state: "connected", label: "Team", last4: "r9Qp", events: [], fields: ["name", "phone_masked", "outcome"], language: "en", test_passed: false, health: { status: "never_sent", reason: null, last_sent_at: null }, counts_24h: { sent: 0, failed: 0, rate_limited: 0 } });
    const putChannel = vi.fn(async () => ({ ok: true as const, channel: connected }));
    mount(sampleData(), actions({ putChannel }));
    open("teams");
    const input = card("teams").getByLabelText("Workflows webhook address") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(card("teams").getByRole("button", { name: "Connect" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "https://prod-1.westus.logic.azure.com:443/workflows/abc" } });
    fireEvent.click(card("teams").getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(putChannel).toHaveBeenCalledWith("teams", { secrets: { url: "https://prod-1.westus.logic.azure.com:443/workflows/abc" }, fields: ["name", "phone_masked", "outcome"] }));
    expect(await card("teams").findByText(/Key ends in r9Qp/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("logic.azure.com");
  });
  it("a connected channel shows choices, the default details and a test; a failing one says why in closed words", async () => {
    const testChannel = vi.fn(async () => ({ ok: true as const, result: { ok: true, reason: null, channel: NOTIFY_SAMPLE.channels[0]! } }));
    mount(sampleData(), actions({ testChannel }));
    open("slack");
    expect(card("slack").getByLabelText("Name")).toBeChecked();
    expect(card("slack").getByLabelText("Phone number with only the first three digits")).toBeChecked();
    expect(card("slack").getByLabelText("The short reason for the result")).not.toBeChecked();
    fireEvent.click(card("slack").getByRole("button", { name: "Send a test message" }));
    expect(await card("slack").findByText("The test message reached Slack.")).toBeInTheDocument();
    open("telegram");
    expect(card("telegram").getByText(/Messages are not getting through\. The address or token no longer works/)).toBeInTheDocument();
  });
  it("choices are saved as the owner changed them", async () => {
    const putChannel = vi.fn(async () => ({ ok: true as const, channel: NOTIFY_SAMPLE.channels[0]! }));
    mount(sampleData(), actions({ putChannel }));
    open("slack");
    fireEvent.click(card("slack").getByLabelText("The short reason for the result"));
    fireEvent.click(card("slack").getByRole("button", { name: "Save choices" }));
    await waitFor(() => expect(putChannel).toHaveBeenCalledWith("slack", { events: ["new_lead", "missed_call"], fields: ["name", "phone_masked", "outcome", "reason"], language: "en" }));
  });
});

describe("calendars", () => {
  it("Outlook says Needs setup by us and has no button", () => {
    mount();
    open("outlook");
    expect(card("outlook").getByText(/not finished setting this up on our side/)).toBeInTheDocument();
    expect(card("outlook").queryByRole("button", { name: "Connect Outlook" })).toBeNull();
  });
  it("Outlook, once set up on our side, sends the owner to Microsoft", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign }, writable: true });
    const startOutlook = vi.fn(async () => ({ ok: true as const, url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1" }));
    mount({ ...sampleData(), calendars: { ...CALENDARS_SAMPLE, items: CALENDARS_SAMPLE.items.map((c) => (c.kind === "outlook" ? parseCalendar({ kind: "outlook", name: "Outlook", state: "not_connected" }) : c)) } }, actions({ startOutlook }));
    open("outlook");
    fireEvent.click(card("outlook").getByRole("button", { name: "Connect Outlook" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1"));
  });
  it("Cal.com shows its address and secret once after Connect", async () => {
    const calendar = parseCalendar({ kind: "calcom", name: "Cal.com", state: "connected", label: "Studio", health: "ok" });
    const connectCalcom = vi.fn(async () => ({ ok: true as const, saved: { calendar, setup: { webhookUrl: "https://api.example.test/v1/webhooks/calendars/calcom/zzzzzzzzzzzzzzzzzzzzzzzz", secret: "calcomSecretOnce", steps: ["Open Settings in Cal.com."] } } }));
    mount(sampleData(), actions({ connectCalcom }));
    open("calcom");
    fireEvent.click(card("calcom").getByRole("button", { name: "Connect" }));
    expect(await card("calcom").findByDisplayValue("calcomSecretOnce")).toBeInTheDocument();
    fireEvent.click(card("calcom").getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByDisplayValue("calcomSecretOnce")).toBeNull();
  });
  it("a connected Calendly shows its counts, the bookings that need a person and the consent question as a labelled field", () => {
    mount();
    open("calendly");
    expect(card("calendly").getByText(/Last 30 days: 8 booked, 1 cancelled/)).toBeInTheDocument();
    expect(card("calendly").getByText("2 bookings could not be placed in a free slot and need a person.")).toBeInTheDocument();
    expect(card("calendly").getByLabelText(/The question on your booking form/)).toBeInTheDocument();
    const list = document.querySelector('[data-part="needs-person"]') as HTMLElement;
    expect(within(list).getByText("That time is not a slot")).toBeInTheDocument();
    expect(within(list).getByText("You are closed then")).toBeInTheDocument();
  });
  it("a consent question that is too short is not sent", () => {
    mount();
    open("calendly");
    fireEvent.change(card("calendly").getByLabelText(/The question on your booking form/), { target: { value: "ok" } });
    expect(card("calendly").getByRole("button", { name: "Save choices" })).toBeDisabled();
  });
  it("tells the owner what Microsoft sent the browser back with", () => {
    mount(sampleData(), actions(), { outlookResult: "denied" });
    expect(screen.getByText("You did not give permission, so Outlook is not connected.")).toBeInTheDocument();
  });
});

describe("lead-form templates", () => {
  it("opens a template to read its steps, the body it sends, the field table and what is not checked yet", async () => {
    const formTemplate = vi.fn(async () => ({ ok: true as const, template: FORM_DETAIL }));
    mount(sampleData(), actions({ formTemplate }));
    open("typeform");
    await waitFor(() => expect(formTemplate).toHaveBeenCalledWith("typeform"));
    expect(await card("typeform").findByText(/Add this address: https:\/\/api\.example\.test\/v1\/lead-intake\/YOUR-ADDRESS/)).toBeInTheDocument();
    expect(card("typeform").getByLabelText("What the tool sends")).toBeInTheDocument();
    expect(card("typeform").getByText("Not checked yet with a real account")).toBeInTheDocument();
    expect(card("typeform").getByRole("columnheader", { name: "Our field" })).toBeInTheDocument();
  });
});

describe("the words follow the app language", () => {
  it("draws Telugu words when the page passes them", () => {
    mount(sampleData(), actions(), { w: wordsOf("te") });
    expect(card("shopify").getByText("కనెక్ట్ అయింది")).toBeInTheDocument();
    expect(card("outlook").getByText("మేము సెటప్ చేయాలి")).toBeInTheDocument();
  });
});

describe("the readers of the API's answers", () => {
  it("read the closed shapes and refuse a kind they do not know", () => {
    expect(parseShop({ id: SHOPIFY_CONNECTED.id, kind: "shopify", store_label: "a.myshopify.com", state: "connected", settings: { confirm_orders: "cod" }, counts: { orders_30d: 3 } }).orders30d).toBe(3);
    expect(() => parseShop({ id: SHOPIFY_CONNECTED.id, kind: "magento", store_label: "x", state: "connected" })).toThrow();
    expect(() => parseChannel({ kind: "sms", state: "connected" })).toThrow();
  });
});
