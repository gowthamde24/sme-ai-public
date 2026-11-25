"use server";

import { redirect } from "next/navigation";

import {
  changeCalendar, changeShop, connectCalcom, connectCalendly, connectShopify, connectWoo, disconnectCalendar, disconnectChannel, disconnectShop, failOf, getFormTemplate, previewCatalogue, putChannel, saveCatalogue, startOutlook, testChannel, testShop,
  type CalendarChange, type ChannelInput, type Fail, type ShopChange,
} from "@/lib/api/commerce-notify";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

/**
 * The moves of the commerce, messages and calendar cards (Owner and Admin; the API decides again and asks for the second factor where it needs it; docs/contracts/commerce-notify.md). A key is typed into a card, goes to the API in this one call and is
 * never kept here, logged or returned. What is checked here before asking: the tenant and every id are well formed, every text is a plain string of a sane length, every kind is a known word. The server checks them all again.
 */
async function gate(tenantId: string): Promise<{ token: string } | Fail> {
  if (!isCanonicalUuid(tenantId)) return { ok: false, error: "other" };
  const user = await requireUser();
  try {
    const role = (await fetchTenant(user.accessToken, tenantId)).role;
    if (role !== "owner" && role !== "admin") return { ok: false, error: "forbidden" };
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    return { ok: false, error: "other" };
  }
  return { token: user.accessToken };
}
const isFail = (v: { token: string } | Fail): v is Fail => "ok" in v;
const text = (v: unknown, max: number, min = 1): v is string => typeof v === "string" && v.trim().length >= min && v.length <= max;
const opt = (v: unknown, max: number): v is string | undefined => v === undefined || (typeof v === "string" && v.length <= max);
const KIND = /^[a-z0-9_]{2,30}$/;
const bad: Fail = { ok: false, error: "other" };

export async function connectShopifyAction(tenantId: string, i: { id: string; shop: string; clientSecret: string; accessToken?: string; clientId?: string }) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(i?.id) || !text(i.shop, 300) || !text(i.clientSecret, 200, 8) || !opt(i.accessToken, 200) || !opt(i.clientId, 200)) return bad;
  try {
    return { ok: true as const, card: await connectShopify(g.token, tenantId, { id: i.id, shop: i.shop.trim(), clientSecret: i.clientSecret.trim(), ...(i.accessToken?.trim() ? { accessToken: i.accessToken.trim() } : {}), ...(i.clientId?.trim() ? { clientId: i.clientId.trim() } : {}) }) };
  } catch (error) {
    return failOf(error);
  }
}

export async function connectWooAction(tenantId: string, i: { id: string; site: string; key: string; secret: string }) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(i?.id) || !text(i.site, 300) || !text(i.key, 200, 8) || !text(i.secret, 200, 8)) return bad;
  try {
    return { ok: true as const, card: await connectWoo(g.token, tenantId, { id: i.id, site: i.site.trim(), key: i.key.trim(), secret: i.secret.trim() }) };
  } catch (error) {
    return failOf(error);
  }
}

export async function changeShopAction(tenantId: string, id: string, patch: ShopChange) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  const ok = isCanonicalUuid(id) && typeof patch === "object" && patch !== null && Object.keys(patch).every((k) => ["confirm_orders", "abandoned", "abandoned_after_min", "checkout_consent", "share_status"].includes(k));
  if (!ok) return bad;
  try {
    return { ok: true as const, connection: await changeShop(g.token, tenantId, id, patch) };
  } catch (error) {
    return failOf(error);
  }
}

export async function testShopAction(tenantId: string, id: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(id)) return bad;
  try {
    return { ok: true as const, connection: await testShop(g.token, tenantId, id) };
  } catch (error) {
    return failOf(error);
  }
}

export async function disconnectShopAction(tenantId: string, id: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(id)) return bad;
  try {
    await disconnectShop(g.token, tenantId, id);
    return { ok: true as const };
  } catch (error) {
    return failOf(error);
  }
}

export async function previewCatalogueAction(tenantId: string, id: string, listId: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(id) || !isCanonicalUuid(listId)) return bad;
  try {
    return { ok: true as const, preview: await previewCatalogue(g.token, tenantId, id, listId) };
  } catch (error) {
    return failOf(error);
  }
}

export async function saveCatalogueAction(tenantId: string, id: string, listId: string, rows: { name: string; cells: Record<string, string | number | boolean | null> }[]) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!isCanonicalUuid(id) || !isCanonicalUuid(listId) || !Array.isArray(rows) || rows.length < 1 || rows.length > 1000 || !rows.every((r) => text(r?.name, 120) && typeof r.cells === "object" && r.cells !== null)) return bad;
  try {
    return { ok: true as const, ...(await saveCatalogue(g.token, tenantId, id, listId, rows)) };
  } catch (error) {
    return failOf(error);
  }
}

export async function putChannelAction(tenantId: string, kind: string, input: ChannelInput) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  const secrets = input?.secrets ?? {};
  const okSecrets = typeof secrets === "object" && secrets !== null && Object.entries(secrets).every(([k, v]) => ["url", "token", "chat_id"].includes(k) && text(v, 600));
  if (!KIND.test(kind) || !okSecrets || !opt(input?.label, 60) || !(input.events === undefined || Array.isArray(input.events)) || !(input.fields === undefined || Array.isArray(input.fields)) || !opt(input?.language, 2)) return bad;
  try {
    return { ok: true as const, channel: await putChannel(g.token, tenantId, kind, input) };
  } catch (error) {
    return failOf(error);
  }
}

export async function testChannelAction(tenantId: string, kind: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!KIND.test(kind)) return bad;
  try {
    return { ok: true as const, result: await testChannel(g.token, tenantId, kind) };
  } catch (error) {
    return failOf(error);
  }
}

export async function disconnectChannelAction(tenantId: string, kind: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!KIND.test(kind)) return bad;
  try {
    await disconnectChannel(g.token, tenantId, kind);
    return { ok: true as const };
  } catch (error) {
    return failOf(error);
  }
}

export async function connectCalendlyAction(tenantId: string, i: { accessToken: string; bookingLink?: string }) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!text(i?.accessToken, 600, 8) || !opt(i.bookingLink, 300)) return bad;
  try {
    return { ok: true as const, saved: await connectCalendly(g.token, tenantId, { accessToken: i.accessToken.trim(), ...(i.bookingLink?.trim() ? { bookingLink: i.bookingLink.trim() } : {}) }) };
  } catch (error) {
    return failOf(error);
  }
}

export async function connectCalcomAction(tenantId: string, i: { bookingLink?: string; label?: string }) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!opt(i?.bookingLink, 300) || !opt(i?.label, 60)) return bad;
  try {
    return { ok: true as const, saved: await connectCalcom(g.token, tenantId, { ...(i.bookingLink?.trim() ? { bookingLink: i.bookingLink.trim() } : {}), ...(i.label?.trim() ? { label: i.label.trim() } : {}) }) };
  } catch (error) {
    return failOf(error);
  }
}

export async function changeCalendarAction(tenantId: string, kind: string, patch: CalendarChange) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  const ok = KIND.test(kind) && typeof patch === "object" && patch !== null && Object.keys(patch).every((k) => ["booking_link", "share_link", "consent_question", "write_events", "block_busy"].includes(k));
  if (!ok) return bad;
  try {
    return { ok: true as const, calendar: await changeCalendar(g.token, tenantId, kind, patch) };
  } catch (error) {
    return failOf(error);
  }
}

export async function disconnectCalendarAction(tenantId: string, kind: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!KIND.test(kind)) return bad;
  try {
    await disconnectCalendar(g.token, tenantId, kind);
    return { ok: true as const };
  } catch (error) {
    return failOf(error);
  }
}

export async function startOutlookAction(tenantId: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  try {
    return { ok: true as const, url: await startOutlook(g.token, tenantId) };
  } catch (error) {
    return failOf(error);
  }
}

export async function formTemplateAction(tenantId: string, id: string) {
  const g = await gate(tenantId);
  if (isFail(g)) return g;
  if (!KIND.test(id)) return bad;
  try {
    return { ok: true as const, template: await getFormTemplate(g.token, tenantId, id) };
  } catch (error) {
    return failOf(error);
  }
}
