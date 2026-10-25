// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { allModules } from "./pack-test-kit";
import { moduleForPath } from "./guard";

const T = "22222222-2222-2222-2222-222222222222";
const WEB = path.resolve(import.meta.dirname, "..", "..");
const TENANT = path.join(WEB, "app", "app", "tenants", "[tenantId]");

describe("which module a page needs", () => {
  const at = (p: string) => moduleForPath(`/app/tenants/${T}${p}`)?.module ?? null;
  it("follows the menu: a page belongs to the item it is under", () => {
    expect(at("/orders")).toBe("orders");
    expect(at("/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("orders");
    expect(at("/quotes")).toBe("quotes");
    expect(at("/enquiries/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("quotes");
    expect(at("/chats")).toBe("inbox");
    expect(at("/catalogue/new")).toBe("catalogue");
    expect(at("/price-list")).toBe("quotes");
    expect(at("/retailers")).toBe("lead_finder");
    expect(at("/fees")).toBe("fees");
    expect(at("/campaigns")).toBe("campaigns");
    expect(at("/followups/policy")).toBe("enquiries");
    expect(at("/customers/new")).toBe("contacts");
    expect(at("/integrations/whatsapp")).toBe("integrations");
    expect(at("/visits")).toBe("visits");
    expect(at("/office")).toBe("office");
    expect(at("/agents")).toBe("office");
  });
  it("uses the home's ?tab= (Customers and Leads are tabs of the home)", () => {
    expect(moduleForPath(`/app/tenants/${T}?tab=companies`)?.module).toBe("contacts");
    expect(moduleForPath(`/app/tenants/${T}?tab=contacts&cursor=abc`)?.module).toBe("contacts");
    expect(moduleForPath(`/app/tenants/${T}?tab=leads`)?.module).toBe("enquiries");
    expect(moduleForPath(`/app/tenants/${T}?_rsc=abc&tab=leads`)?.module).toBe("enquiries");
  });
  it("needs nothing for Today, Start, Settings, Help, Privacy, the account pages or a path that is not a workspace", () => {
    for (const p of ["", "/start", "/settings", "/help", "/help/outbox", "/privacy", "/suppression", "/notifications"]) expect(at(p), p).toBeNull();
    for (const p of ["/app", "/app/security", "/login", "", "/app/tenants/not-a-uuid/orders"]) expect(moduleForPath(p), p).toBeNull();
    expect(moduleForPath(null)).toBeNull();
    expect(moduleForPath(undefined)).toBeNull();
    expect(moduleForPath(`/app/tenants/${T}/orders?${"x".repeat(3000)}`)).toBeNull();
  });
  it("returns the tenant the path names", () => {
    expect(moduleForPath(`/app/tenants/${T}/fees`)).toEqual({ tenantId: T, module: "fees" });
  });
  it("only ever names a module of the schema's list", () => {
    const routes = walk(TENANT).map((f) => "/" + path.relative(TENANT, path.dirname(f)).replace(/\\/g, "/").replace(/\[[a-zA-Z]+\]/g, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).map((r) => (r === "/." ? "" : r));
    for (const r of routes) {
      const m = at(r);
      if (m) expect(allModules(), r).toContain(m);
    }
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === "page.tsx" ? [path.join(dir, e.name)] : []));
}

describe("every page of a workspace has been decided (a new page must say whether it needs a module)", () => {
  const sample = (r: string) => r.replace(/\[[a-zA-Z]+\]/g, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const at = (p: string) => moduleForPath(`/app/tenants/${T}${p}`)?.module ?? null;
  const routes = walk(TENANT).map((f) => "/" + path.relative(TENANT, path.dirname(f)).replace(/\\/g, "/")).map((r) => (r === "/" ? "" : r));
  // Pages that need NO module on purpose: Today and its Start page, Settings, Help, the privacy and suppression pages, the team, the outbox: the places every business type has (the closed module list of packages/packs has no module for them).
  const OPEN = ["", "/help", "/help/[guide]", "/outbox", "/plans", "/privacy", "/settings", "/start", "/suppression", "/team"];
  it("finds the pages", () => {
    expect(routes.length).toBeGreaterThan(30);
  });
  it("the pages that need no module are exactly the short list above; every other page is under a menu item that names one", () => {
    expect(routes.filter((r) => at(sample(r)) === null).sort()).toEqual(OPEN);
  });
  it("every page under a menu item is guarded by that item's module (so a hidden item can never be reached by its address)", () => {
    const guarded = Object.fromEntries(routes.filter((r) => at(sample(r)) !== null).map((r) => [r, at(sample(r))]));
    expect(guarded["/orders"]).toBe("orders");
    expect(guarded["/orders/[orderId]"]).toBe("orders");
    expect(guarded["/quotes"]).toBe("quotes");
    expect(guarded["/chats/[leadId]"]).toBe("inbox");
    expect(guarded["/review"]).toBe("enquiries");
    expect(guarded["/leads/[leadId]"]).toBe("enquiries");
    expect(at("/fees")).toBe("fees");
    expect(at("/campaigns")).toBe("campaigns");
  });
});
