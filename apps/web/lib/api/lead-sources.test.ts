import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiContractError } from "./client";
import { createSource, discardUnparsed, listSources, listUnparsed, parseSecret, parseSource, parseSourceWithSecret, pullIndiaMart, rotateSource, setSourceStatus } from "./lead-sources";

const T = "22222222-2222-4222-8222-222222222222";
const ID = "11111111-1111-4111-8111-111111111111";
const SOURCE = { id: ID, kind: "website_form", tag: "website_form", label: "Website", status: "active", created_at: "2026-10-26T10:00:00Z", last_received_at: null, received_count: 0, token_hint: "a1b2", cost_per_lead_paise: null, consent_confirmed: false, available: true };
const SECRET = { shown_once: true, url: "https://api.example.test/v1/lead-intake/TOKEN", email_address: null, snippet_html: "<form></form>", meta_callback_url: null, meta_verify_token: null };

describe("lead sources: strict readers", () => {
  it("reads a source and its secret", () => {
    expect(parseSource(SOURCE).token_hint).toBe("a1b2");
    expect(parseSourceWithSecret({ ...SOURCE, secret: SECRET }).secret?.url).toContain("lead-intake");
    expect(parseSourceWithSecret({ ...SOURCE, secret: null }).secret).toBeNull();
    expect(parseSourceWithSecret(SOURCE).secret).toBeNull();
    expect(parseSecret(null)).toBeNull();
  });
  it("refuses an answer that is not the contract, and a failed read never names the secret value", () => {
    expect(() => parseSource({ ...SOURCE, kind: "fax" })).toThrow(ApiContractError);
    expect(() => parseSource({ ...SOURCE, tag: "tiktok" })).toThrow(ApiContractError);
    expect(() => parseSource({ ...SOURCE, status: "deleted" })).toThrow(ApiContractError);
    expect(() => parseSource({ ...SOURCE, available: "yes" })).toThrow(ApiContractError);
    expect(() => parseSource({ ...SOURCE, id: "x" })).toThrow(ApiContractError);
    let message = "";
    try {
      parseSourceWithSecret({ ...SOURCE, secret: { ...SECRET, shown_once: false } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("TOKEN");
    try {
      parseSecret({ ...SECRET, url: 42 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("42");
  });
});

describe("lead sources: the calls", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const urlOf = (f: ReturnType<typeof stub>) => String((f.mock.calls[0] as unknown as [string])[0]);

  it("lists, creates (with the secret), rotates (with a new secret), pauses and resumes", async () => {
    let f = stub(200, { items: [SOURCE] });
    expect((await listSources("tok", T))[0].label).toBe("Website");
    expect(urlOf(f)).toMatch(new RegExp(`/v1/tenants/${T}/lead-sources$`));
    f = stub(201, { ...SOURCE, secret: SECRET });
    const made = await createSource("tok", T, { source_id: ID, kind: "website_form", label: "Website", portal: null, consent: null, cost_per_lead_paise: null });
    expect(made.secret?.snippet_html).toBe("<form></form>");
    f = stub(200, { ...SOURCE, secret: { ...SECRET, url: "https://api.example.test/v1/lead-intake/NEW" } });
    expect((await rotateSource("tok", T, ID)).secret?.url).toMatch(/NEW$/);
    expect(urlOf(f)).toMatch(new RegExp(`lead-sources/${ID}/rotate$`));
    f = stub(200, { ...SOURCE, status: "paused" });
    expect((await setSourceStatus("tok", T, ID, "pause")).status).toBe("paused");
    expect(urlOf(f)).toMatch(/\/pause$/);
    f = stub(200, SOURCE);
    expect((await setSourceStatus("tok", T, ID, "resume")).status).toBe("active");
  });
  it("pulls IndiaMART and reads the unparsed mail, discards one", async () => {
    let f = stub(200, { fetched: 5, created: 3, merged: 1, invalid: 0, existing: 1, window_start: "2026-10-25T10:00:00Z", window_end: "2026-10-26T10:00:00Z" });
    expect((await pullIndiaMart("tok", T)).created).toBe(3);
    expect(urlOf(f)).toMatch(/lead-sources\/indiamart\/pull$/);
    f = stub(200, { items: [{ id: ID, source_id: ID, received_at: "2026-10-26T10:00:00Z", subject: null, preview: "Hello" }] });
    expect((await listUnparsed("tok", T))[0].subject).toBeNull();
    expect(urlOf(f)).toMatch(/lead-sources\/unparsed$/);
    f = stub(200, {});
    await discardUnparsed("tok", T, ID);
    expect(urlOf(f)).toMatch(new RegExp(`unparsed/${ID}/discard$`));
    await expect(discardUnparsed("tok", T, "x")).rejects.toThrow(ApiContractError);
    await expect(rotateSource("tok", "nope", ID)).rejects.toThrow(ApiContractError);
  });
});
