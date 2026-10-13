/**
 * The invented data of the visual tests (e2e/visual/fixtures.mjs, job BX) must keep matching the API's contract: each answer is run through the REAL parser the app uses. If an API shape changes and a parser starts
 * refusing the fixture, this test fails here, in `npm test`, instead of the visual run quietly drawing "Not available yet" in the pictures.
 */
import { describe, expect, it } from "vitest";

import { parseAgentsStatus, parseToday } from "@/lib/api/today";
import { parseAiUsage } from "@/lib/api/ai-usage";
import { parseCallRequestPage, parseOutboxPage, parseOutboxSettings, parseOutboxSummary } from "@/lib/api/outbox";
import { parseItemPage } from "@/lib/api/catalogue";
import { parseMembers } from "@/lib/api/orders";
import { parseInvitations, parseTeam } from "@/lib/api/team";
import { parseTenantDetail } from "@/lib/api/client";
import { parsePlan } from "@/lib/api/plan";
import { parseQuoteSummary } from "@/lib/api/quotes";
import { parseSettings, parseSlots, parseTodayVisits, parseVisitList, parseWeek } from "@/lib/api/visits";
import { parseEvidencePage } from "@/lib/api/evidence";
import { parseClaim } from "@/lib/api/agents";

import * as fixtures from "../../../e2e/visual/fixtures.mjs";

type Fixtures = { API_ROUTES: [RegExp, unknown][]; TENANT: string; LEAD: string; FIXED_NOW: string };
const load = async (): Promise<Fixtures> => fixtures as unknown as Fixtures;

async function answer(suffix: string, query = ""): Promise<unknown> {
  const { API_ROUTES, TENANT } = await load();
  const pathname = suffix.startsWith("/v1/") ? suffix : `/v1/tenants/${TENANT}${suffix}`;
  for (const [pattern, body] of API_ROUTES) {
    const match = pattern.exec(pathname);
    if (match) return typeof body === "function" ? (body as (c: unknown) => unknown)({ url: new URL(`https://stand-in.invalid${pathname}${query}`), match }) : body;
  }
  throw new Error(`no fixture for ${pathname}`);
}

describe("the visual tests' fixtures are in the API's contract", () => {
  it("the workspace and its plan", async () => {
    expect(parseTenantDetail(await answer("")).role).toBe("owner");
    expect(parsePlan(await answer("")).plan).toBe("free_trial");
  });
  it("Today, the helpers and the AI use", async () => {
    expect(parseToday(await answer("/today")).needs_you.length).toBeGreaterThan(0);
    expect(parseAgentsStatus(await answer("/agents/status")).length).toBeGreaterThan(0);
    expect(parseAiUsage(await answer("/ai-usage")).state).toBe("ok");
    expect(parseWeek(await answer("/ai-usage/week")).week_percent).toBeGreaterThan(0);
  });
  it("members and quotes", async () => {
    expect(parseMembers(await answer("/members")).length).toBe(2);
    expect(parseInvitations(await answer("/invitations"))).toEqual([]);
    expect(parseTeam(await answer("/team")).members).toHaveLength(4);
    for (const q of (await answer("/quotes")) as unknown[]) expect(parseQuoteSummary(q).quote_no).toBe(3);
  });
  it("the Outbox: messages by tab, the counts, the settings, the approvals and the call requests", async () => {
    for (const tab of ["waiting", "sent", "blocked", "scheduled"]) expect(Array.isArray(parseOutboxPage(await answer("/outbox/messages", `?tab=${tab}`)).items)).toBe(true);
    expect(parseOutboxPage(await answer("/outbox/messages", "?tab=waiting")).items).toHaveLength(1);
    expect(parseOutboxSummary(await answer("/outbox/summary")).sent).toBe(1);
    expect(parseOutboxSettings(await answer("/outbox/settings")).quiet_hours_start).toBe(21);
    expect(parseOutboxPage(await answer("/outbox/approvals")).items).toHaveLength(1);
    expect(parseCallRequestPage(await answer("/call-requests")).items).toHaveLength(1);
  });
  it("Visits: today's, the day's list, the slots and the store hours", async () => {
    expect(parseTodayVisits(await answer("/visits/today")).items).toHaveLength(2);
    expect(parseVisitList(await answer("/visits", "?from=2026-10-14&to=2026-10-14")).items.length).toBe(3);
    expect(parseVisitList(await answer("/visits", "?status=booked")).items.every((v) => v.status === "booked")).toBe(true);
    expect(parseSlots(await answer("/visits/slots", "?date=2026-10-14")).open).toBe(true);
    expect(parseSettings(await answer("/visits/settings")).slot_minutes).toBe(30);
  });
  it("the saree catalogue", async () => {
    expect(parseItemPage(await answer("/catalogue/items")).items).toHaveLength(4);
  });
  it("a lead: its evidence and a suggestion", async () => {
    const { LEAD } = await load();
    expect(parseEvidencePage(await answer(`/leads/${LEAD}/evidence`)).items).toHaveLength(2);
    for (const c of (await answer(`/leads/${LEAD}/claims`)) as unknown[]) expect(parseClaim(c).review_state).toBe("unreviewed");
  });
  it("invents nobody real: only example addresses and fictional names", async () => {
    const text = JSON.stringify((await load()).API_ROUTES.map(([, b]) => (typeof b === "function" ? "" : b)));
    expect(text).not.toMatch(/@(?!example\.test|visual\.example\.test)[a-z0-9-]+\.[a-z]+/i);
    expect(text).not.toMatch(/\+91\d{6,}/);
  });
});
