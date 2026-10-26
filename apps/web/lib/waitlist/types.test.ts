import { describe, expect, it } from "vitest";

import { BUSINESS_TYPES, readContact, readWaitlist, WAITLIST_LANGS } from "./types";

const good = { name: "  Lakshmi   Devi ", businessType: "textiles", city: "Guntur", contact: "+91 98765 43210", language: "te", marketingOptIn: false };

describe("the waitlist form's checks (job DQ)", () => {
  it("reads a phone number (spaces, dashes and brackets allowed, 7 to 15 digits) or an e-mail, and nothing else", () => {
    expect(readContact("+91 98765-43210")).toEqual({ phone: "+919876543210", email: null });
    expect(readContact("(040) 2345 6789")).toEqual({ phone: "04023456789", email: null });
    expect(readContact("Owner@Shop.Example")).toEqual({ phone: null, email: "owner@shop.example" });
    for (const bad of ["", "   ", "123456", "1234567890123456", "abc", "a@b", "a b@c.example", "x@@y.example", "<a>@b.example", null, 12345, undefined]) expect(readContact(bad), String(bad)).toBeNull();
  });

  it("a good form becomes one clean record: one-line text, the marketing choice exactly as given", () => {
    const r = readWaitlist(good);
    expect(r).toEqual({ ok: true, value: { name: "Lakshmi Devi", businessType: "textiles", city: "Guntur", phone: "+919876543210", email: null, language: "te", marketingOptIn: false } });
  });

  it("marketing is off unless it is exactly true (a string, a number or nothing is no)", () => {
    for (const v of [undefined, null, "true", "on", 1, "yes", {}]) expect(readWaitlist({ ...good, marketingOptIn: v })).toMatchObject({ ok: true, value: { marketingOptIn: false } });
    expect(readWaitlist({ ...good, marketingOptIn: true })).toMatchObject({ ok: true, value: { marketingOptIn: true } });
  });

  it("refuses a form without a name, a city or a way to reach the person, saying which", () => {
    expect(readWaitlist({ ...good, name: "  " })).toEqual({ ok: false, error: "name" });
    expect(readWaitlist({ ...good, city: "" })).toEqual({ ok: false, error: "city" });
    expect(readWaitlist({ ...good, contact: "nope" })).toEqual({ ok: false, error: "contact" });
    expect(readWaitlist(null)).toEqual({ ok: false, error: "name" });
    expect(readWaitlist("x")).toEqual({ ok: false, error: "name" });
  });

  it("an unknown business type is 'other' and an unknown language is English; control characters become spaces and the length is cut", () => {
    expect(readWaitlist({ ...good, businessType: "hacking", language: "xx" })).toMatchObject({ ok: true, value: { businessType: "other", language: "en" } });
    const r = readWaitlist({ ...good, name: `A\u0000B\n${"x".repeat(500)}`, city: "y".repeat(300) });
    expect(r.ok && r.value.name.length).toBe(80);
    expect(r.ok && r.value.name.startsWith("A B x")).toBe(true);
    expect(r.ok && r.value.city.length).toBe(80);
  });

  it("the choices are the ones the API accepts (contract-dpdp.md): three business types and other; six languages", () => {
    expect([...BUSINESS_TYPES]).toEqual(["textiles", "construction", "education", "other"]);
    expect([...WAITLIST_LANGS]).toEqual(["en", "te", "hi", "kn", "ta", "ml"]);
  });
});
