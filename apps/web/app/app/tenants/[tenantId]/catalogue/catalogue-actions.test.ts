import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { parseItem } from "@/lib/api/catalogue";
import { ITEM_A, LEAD_FOUND, PHOTO_A1, PHOTO_A2, itemJson } from "@/lib/api/catalogue-fixtures";
import { parseOutboxMessage } from "@/lib/api/outbox";
import { PRICE_JSON, QUIET_JSON, SENT_JSON } from "@/lib/api/outbox-fixtures";

const putCatalogueItem = vi.fn();
const removeCataloguePhoto = vi.fn();
const reorderCataloguePhotos = vi.fn();
const searchLeads = vi.fn();
const submitOutboxMessage = vi.fn();
const revalidatePath = vi.fn();
const redirectMock = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "u", email: "e@example.test", accessToken: "tok" }) }));
vi.mock("@/i18n/get-lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/api/catalogue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/catalogue")>()),
  putCatalogueItem: (...a: unknown[]) => putCatalogueItem(...a),
  removeCataloguePhoto: (...a: unknown[]) => removeCataloguePhoto(...a),
  reorderCataloguePhotos: (...a: unknown[]) => reorderCataloguePhotos(...a),
}));
vi.mock("@/lib/api/lead-search", () => ({ searchLeads: (...a: unknown[]) => searchLeads(...a) }));
vi.mock("@/lib/api/outbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/outbox")>()), submitOutboxMessage: (...a: unknown[]) => submitOutboxMessage(...a) }));

import { removePhotoAction, reorderPhotosAction, saveItemAction, searchLeadsAction, sendCatalogueAction } from "./catalogue-actions";

const T = "22222222-2222-4222-8222-222222222222";
const MSG = "11111111-aaaa-4aaa-8aaa-000000000001";
const saved = parseItem(itemJson());
const refusal = (status: number, code: string) => new ApiRequestError(status, code, "the API's own English sentence that must never reach the person");
const input = { name: "  Maroon Kanchi pattu ", fabric: "kanchi_pattu" as const, colours: ["maroon" as const], zari: "rich" as const, border: " Temple border ", occasions: ["wedding" as const], priceBand: "25k_50k" as const, stockStatus: "in_stock" as const, active: true };

beforeEach(() => vi.clearAllMocks());

describe("save a saree", () => {
  it("saves with the person's token, trims the words, and leaves the exact price out when none is sent", async () => {
    putCatalogueItem.mockResolvedValue({ item: saved, created: true });
    const r = await saveItemAction(T, ITEM_A, input);
    expect(r).toEqual({ ok: true, item: saved });
    const [token, tenant, id, sent] = putCatalogueItem.mock.calls[0];
    expect([token, tenant, id]).toEqual(["tok", T, ITEM_A]);
    expect(sent).toEqual({ name: "Maroon Kanchi pattu", fabric: "kanchi_pattu", colours: ["maroon"], zari: "rich", border: "Temple border", occasions: ["wedding"], priceBand: "25k_50k", stockStatus: "in_stock", active: true });
    expect("price" in sent).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/catalogue`);
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/catalogue/${ITEM_A}`);
  });

  it("an empty border is none", async () => {
    putCatalogueItem.mockResolvedValue({ item: saved, created: false });
    await saveItemAction(T, ITEM_A, { ...input, border: null });
    expect(putCatalogueItem.mock.calls[0][3].border).toBeNull();
  });

  it("turns rupees into paise to set the exact price, and sends a clear as a clear", async () => {
    putCatalogueItem.mockResolvedValue({ item: saved, created: false });
    await saveItemAction(T, ITEM_A, { ...input, price: { rupees: 38500.5 } });
    expect(putCatalogueItem.mock.calls[0][3].price).toEqual({ paise: 3_850_050 });
    await saveItemAction(T, ITEM_A, { ...input, price: { clear: true } });
    expect(putCatalogueItem.mock.calls[1][3].price).toEqual({ clear: true });
  });

  it.each([
    ["a bad tenant", { tenant: "x" }],
    ["a bad item id", { id: "x" }],
    ["no name", { over: { name: "   " } }],
    ["a name over 120", { over: { name: "n".repeat(121) } }],
    ["an unknown fabric", { over: { fabric: "velvet" } }],
    ["no colour", { over: { colours: [] } }],
    ["five colours", { over: { colours: ["red", "blue", "green", "pink", "gold"] } }],
    ["the same colour twice", { over: { colours: ["red", "red"] } }],
    ["an unknown occasion", { over: { occasions: ["funeral"] } }],
    ["an unknown band", { over: { priceBand: "free" } }],
    ["an unknown stock word", { over: { stockStatus: "gone" } }],
    ["a non-boolean active", { over: { active: "yes" } }],
    ["a border over 120", { over: { border: "b".repeat(121) } }],
    ["a clear that is not true", { over: { price: { clear: false } } }],
  ])("refuses %s before any request", async (_what, spec: Record<string, unknown>) => {
    const r = await saveItemAction((spec.tenant as string) ?? T, (spec.id as string) ?? ITEM_A, { ...input, ...((spec.over as object) ?? {}) } as never);
    expect(r).toMatchObject({ ok: false });
    expect(putCatalogueItem).not.toHaveBeenCalled();
  });

  it.each([0, 0.5, 1_000_001, Number.NaN, Infinity])("refuses an exact price of %s rupees in words about money", async (rupees) => {
    const r = await saveItemAction(T, ITEM_A, { ...input, price: { rupees } });
    expect(r).toEqual({ ok: false, error: "The exact price must be between ₹1 and ₹10,00,000." });
    expect(putCatalogueItem).not.toHaveBeenCalled();
  });

  it("says 'needs your authenticator' for a missing second factor and points at it; an admin who sends a price is told only the owner can", async () => {
    putCatalogueItem.mockRejectedValueOnce(refusal(403, "mfa_required"));
    expect(await saveItemAction(T, ITEM_A, { ...input, price: { rupees: 100 } })).toMatchObject({ ok: false, mfa: true, error: expect.stringContaining("authenticator") });
    putCatalogueItem.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await saveItemAction(T, ITEM_A, { ...input, price: { rupees: 100 } })).toEqual({ ok: false, error: expect.stringContaining("Only the owner can set the exact price") });
    putCatalogueItem.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await saveItemAction(T, ITEM_A, input)).toEqual({ ok: false, error: "Your role does not allow this. Nothing was changed." });
  });

  it("explains 'needs a photo' in its own words and never passes the API's text on", async () => {
    putCatalogueItem.mockRejectedValue(refusal(409, "needs_photo"));
    const r = await saveItemAction(T, ITEM_A, input);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("at least one photo") });
    expect(JSON.stringify(r)).not.toContain("API's own English");
  });

  it("a rejected session goes to sign-in", async () => {
    putCatalogueItem.mockRejectedValue(new ApiAuthError("x"));
    await expect(saveItemAction(T, ITEM_A, input)).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("remove and reorder photos", () => {
  it("removes with the token and returns the item; the last photo of a shown saree is explained", async () => {
    removeCataloguePhoto.mockResolvedValue(saved);
    expect(await removePhotoAction(T, PHOTO_A1)).toEqual({ ok: true, item: saved });
    expect(removeCataloguePhoto).toHaveBeenCalledWith("tok", T, PHOTO_A1);
    removeCataloguePhoto.mockRejectedValue(refusal(409, "needs_photo"));
    expect(await removePhotoAction(T, PHOTO_A1)).toMatchObject({ ok: false, error: expect.stringContaining("last photo") });
    expect(await removePhotoAction(T, "x")).toMatchObject({ ok: false, stale: true });
  });

  it("reorders every live photo once; a list with a repeat, a stranger or more than eight is refused first", async () => {
    reorderCataloguePhotos.mockResolvedValue(saved);
    expect(await reorderPhotosAction(T, ITEM_A, [PHOTO_A2, PHOTO_A1])).toEqual({ ok: true, item: saved });
    expect(reorderCataloguePhotos).toHaveBeenCalledWith("tok", T, ITEM_A, [PHOTO_A2, PHOTO_A1]);
    for (const bad of [[], [PHOTO_A1, PHOTO_A1], ["x"], Array.from({ length: 9 }, (_, i) => `0f8a927d-1111-4a11-8a11-00000000000${i}`)]) {
      reorderCataloguePhotos.mockClear();
      expect(await reorderPhotosAction(T, ITEM_A, bad as string[])).toMatchObject({ ok: false });
      expect(reorderCataloguePhotos).not.toHaveBeenCalled();
    }
  });
});

describe("find a customer", () => {
  it("returns the hits for two letters or more; shorter is an empty list without a request", async () => {
    searchLeads.mockResolvedValue([{ leadId: LEAD_FOUND, customer: "Sri", city: null, contactName: null, phoneLast4: "0001" }]);
    expect(await searchLeadsAction(T, " Sri ")).toEqual({ ok: true, items: [{ leadId: LEAD_FOUND, customer: "Sri", city: null, contactName: null, phoneLast4: "0001" }] });
    expect(searchLeads).toHaveBeenCalledWith("tok", T, "Sri");
    searchLeads.mockClear();
    expect(await searchLeadsAction(T, "a")).toEqual({ ok: true, items: [] });
    expect(searchLeads).not.toHaveBeenCalled();
  });

  it("a failed search is a sentence of ours", async () => {
    searchLeads.mockRejectedValue(refusal(503, "api_unreachable"));
    expect(await searchLeadsAction(T, "Sri")).toEqual({ ok: false, error: "The catalogue is not available right now. Try again shortly." });
  });
});

describe("send a saree to a customer", () => {
  const send = { messageId: MSG, itemId: ITEM_A, leadId: LEAD_FOUND, photoIds: [PHOTO_A1, PHOTO_A2], text: "  Here is a saree.  ", language: "en", keepRecord: true };
  const answer = (over: Record<string, unknown>) => ({ message: parseOutboxMessage({ ...SENT_JSON, ...over }), replayed: false });

  it("puts ONE message with the photos in the outbox: info, the photo ids in order, the record choice, no price and no number", async () => {
    submitOutboxMessage.mockResolvedValue(answer({}));
    await sendCatalogueAction(T, send);
    expect(submitOutboxMessage).toHaveBeenCalledTimes(1);
    expect(submitOutboxMessage).toHaveBeenCalledWith("tok", T, { messageId: MSG, leadId: LEAD_FOUND, text: "Here is a saree.", language: "en", category: "info", photoIds: [PHOTO_A1, PHOTO_A2], keepRecord: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}/outbox`);
  });

  it("sent: says it was sent", async () => {
    submitOutboxMessage.mockResolvedValue(answer({ status: "sent", reason: "auto_allowed" }));
    expect(await sendCatalogueAction(T, send)).toMatchObject({ ok: true, state: "sent", text: "Sent to the customer.", why: null });
  });

  it.each([
    ["money", "the caption mentions a price."],
    ["commitment", "the caption makes a promise."],
    ["complaint", "the caption touches a complaint."],
    ["model_flagged", "the checker asked for a person to look at it."],
    ["uncertain", "the words could not be checked yet."],
    ["category_other", "it is not a routine message."],
    ["no_inbound_window", "this customer has not written to the shop lately."],
    ["auto_off", "automatic sending is off for this business, so every message waits for approval."],
  ])("waiting for approval because of %s: says so, and why, in plain words", async (reason, why) => {
    submitOutboxMessage.mockResolvedValue(answer({ status: "needs_approval", reason, sent_at: null }));
    const r = await sendCatalogueAction(T, send);
    expect(r).toMatchObject({ ok: true, state: "needs_approval", text: "Waiting for the owner or an admin to approve it.", why: `Why it waits: ${why}` });
  });

  it("a reason this screen has no words for still says that a rule asks for approval", async () => {
    submitOutboxMessage.mockResolvedValue(answer({ status: "needs_approval", reason: "owner_approved", sent_at: null }));
    expect(await sendCatalogueAction(T, send)).toMatchObject({ why: "Why it waits: a rule of the shop asks for approval." });
  });

  it("held for the morning: says when it goes out, in India time", async () => {
    submitOutboxMessage.mockResolvedValue({ message: parseOutboxMessage({ ...QUIET_JSON, scheduled_for: "2099-01-01T03:30:00Z" }), replayed: false });
    expect(await sendCatalogueAction(T, send)).toMatchObject({ ok: true, state: "queued", text: expect.stringMatching(/^Queued\. It goes out at 9:00/) });
  });

  it.each([
    ["stopped", "this customer asked us to stop."],
    ["no_opt_in", "the customer has not agreed to WhatsApp messages."],
    ["daily_limit", "this customer already has the daily limit of messages."],
    ["switch_off", "sending is switched off."],
    ["no_contact", "a rule of the system stopped it."],
  ])("blocked because of %s: says it was NOT sent, and why", async (reason, why) => {
    submitOutboxMessage.mockResolvedValue(answer({ status: "blocked", reason, sent_at: null }));
    expect(await sendCatalogueAction(T, send)).toMatchObject({ ok: true, state: "blocked", text: `Not sent: ${why}` });
  });

  it("a failed send is 'WhatsApp did not take it', not a success", async () => {
    submitOutboxMessage.mockResolvedValue(answer({ status: "failed", reason: "send_failed", failure_code: "rejected", sent_at: null }));
    expect(await sendCatalogueAction(T, send)).toMatchObject({ state: "blocked", text: "Not sent: WhatsApp did not take it." });
  });

  it("says whether a record was asked for", async () => {
    submitOutboxMessage.mockResolvedValue(answer({}));
    expect((await sendCatalogueAction(T, send) as { recordText: string }).recordText).toContain("Keep a record is on");
    const off = (await sendCatalogueAction(T, { ...send, keepRecord: false })) as { recordText: string };
    expect(off.recordText).toBe("No record was made, as you chose.");
    expect(submitOutboxMessage.mock.calls[1][2].keepRecord).toBe(false);
  });

  it.each([
    ["a bad message id", { messageId: "x" }],
    ["a bad lead id", { leadId: "x" }],
    ["a bad item id", { itemId: "x" }],
    ["no photo", { photoIds: [] }],
    ["five photos", { photoIds: Array.from({ length: 5 }, (_, i) => `0f8a927d-1111-4a11-8a11-00000000000${i}`) }],
    ["the same photo twice", { photoIds: [PHOTO_A1, PHOTO_A1] }],
    ["a photo id that is not a uuid", { photoIds: ["../../x"] }],
    ["a caption of one letter", { text: "x" }],
    ["a caption over 1000", { text: "x".repeat(1001) }],
    ["a language we do not send in", { language: "fr" }],
  ])("refuses %s before anything is sent", async (_what, over) => {
    const r = await sendCatalogueAction(T, { ...send, ...over } as never);
    expect(r).toMatchObject({ ok: false });
    expect(submitOutboxMessage).not.toHaveBeenCalled();
  });

  it("explains a refusal in our words: a photo that is gone, a customer who said stop, a missing second factor, a role", async () => {
    submitOutboxMessage.mockRejectedValueOnce(refusal(422, "invalid_reference"));
    expect(await sendCatalogueAction(T, send)).toEqual({ ok: false, error: "One of the photos is no longer available. Reload the page and choose again. Nothing was sent." });
    submitOutboxMessage.mockRejectedValueOnce(refusal(409, "customer_stopped"));
    expect(await sendCatalogueAction(T, send)).toEqual({ ok: false, error: "This customer asked us to stop. Nothing more is sent or called." });
    submitOutboxMessage.mockRejectedValueOnce(refusal(403, "forbidden"));
    expect(await sendCatalogueAction(T, send)).toEqual({ ok: false, error: "Your role does not allow this. Nothing was changed." });
    submitOutboxMessage.mockRejectedValueOnce(refusal(500, "boom"));
    expect(await sendCatalogueAction(T, send)).toEqual({ ok: false, error: "That did not work. Nothing was changed. Try again." });
  });

  it("a rejected session goes to sign-in", async () => {
    submitOutboxMessage.mockRejectedValue(new ApiAuthError("x"));
    await expect(sendCatalogueAction(T, send)).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("the same message id twice is the API's replay, not a second message from this side", async () => {
    submitOutboxMessage.mockResolvedValue({ ...answer({}), replayed: true });
    await sendCatalogueAction(T, send);
    await sendCatalogueAction(T, send);
    expect(submitOutboxMessage.mock.calls.map((c) => c[2].messageId)).toEqual([MSG, MSG]);
  });
});
void PRICE_JSON;
