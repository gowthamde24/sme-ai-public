import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { siteT } from "@/i18n/site";
import { PLAN_FACTS, PUBLIC_PLANS, rupees } from "@/lib/site/plans";

import { MinutesBilled, PlanCompare, compareRows } from "./PlanDetails";

/** The detailed pricing page (owner, 26 Nov 2026): every number in the comparison comes from lib/site/plans.ts (the one source), and the page states only billing rules that are true today (docs/contracts/call-billing.md). */
afterEach(cleanup);

describe("the plan comparison", () => {
  const t = siteT("en");
  it("has one row for each thing and one value for each plan, with the numbers of PUBLIC_PLANS and PLAN_FACTS", () => {
    const rows = Object.fromEntries(compareRows(t).map((r) => [r.id, r.values]));
    expect(rows.monthly).toEqual(PUBLIC_PLANS.map((p) => `${rupees(p.monthly)} + 18% GST`));
    expect(rows.minutes[1]).toBe("500 minutes");
    expect(rows.minutes[2]).toBe("1,500 minutes");
    expect(rows.minutes[0]).toContain(`₹${PLAN_FACTS.extraMinute} a minute`);
    expect(rows.extra).toEqual(Array(3).fill(`₹${PLAN_FACTS.extraMinute} each`));
    expect(rows.xnumber[0]).toContain(`₹${PLAN_FACTS.extraNumber} a month each`);
    expect(rows.xline[0]).toBe(`₹${PLAN_FACTS.extraLine} a month each`);
    expect(rows.find[1]).toBe("10 a month, then ₹39 each");
    expect(rows.setup[2]).toBe("Priority set-up");
  });
  it("is a table on a laptop and a card for each plan on a phone (the same rows), no sideways scroll", () => {
    const { container } = render(<PlanCompare t={t} />);
    const table = container.querySelector('[data-part="compare-table"]') as HTMLElement;
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["What you get", "Pay as you go", "Pro", "Business"]);
    expect(table.closest("div")?.className).toMatch(/\bhidden\b.*md:block/);
    const cards = container.querySelectorAll('[data-part="compare-cards"] article');
    expect(cards).toHaveLength(3);
    expect((container.querySelector('[data-part="compare-cards"]') as HTMLElement).className).toMatch(/md:hidden/);
    for (const c of cards) expect(c.querySelectorAll("[data-row]")).toHaveLength(compareRows(t).length);
  });
  it("is worded in Telugu with the same numbers", () => {
    const rows = Object.fromEntries(compareRows(siteT("te")).map((r) => [r.id, r.values]));
    expect(rows.minutes[1]).toBe("500 మినిట్లు");
    expect(rows.xline[0]).toContain(`₹${PLAN_FACTS.extraLine}`);
  });
});

describe("how minutes are billed", () => {
  it("says only what is true: 30-second blocks, nobody-answers free, the same rate both ways, testing free, GST on credits, the free start of 30 and 100 rupees", () => {
    const { container } = render(<MinutesBilled t={siteT("en")} lang="en" />);
    const text = container.textContent ?? "";
    expect(text).toContain("every 30 seconds");
    expect(text).toContain("nobody answers cost nothing");
    expect(text).toContain("cost the same as calls we make for you");
    expect(text).toContain("Testing is free");
    expect(text).toContain("18% GST is added when you add credits, not on each call");
    expect(text).toContain(`₹${PLAN_FACTS.trialEmail} when you sign up with your e-mail, ₹${PLAN_FACTS.trialPhone} once you verify your phone`);
    expect(text).not.toMatch(/never expire|14 days|unlimited/i);
    expect(container.querySelector("a")?.getAttribute("href")).toMatch(/refunds/);
  });
});
