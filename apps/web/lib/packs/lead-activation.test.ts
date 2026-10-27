import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAuthError, ApiRequestError } from "@/lib/api/client";

const listLeadTemplates = vi.fn();
vi.mock("@/lib/api/lead-templates", () => ({ listLeadTemplates: (...a: unknown[]) => listLeadTemplates(...a) }));

import { leadDeskSteps } from "./lead-activation";

const FLAGS = ["LEADS_SCREENS", "OUTREACH_SCREENS", "TASK_SCREENS"] as const;
const flags = (v: Partial<Record<(typeof FLAGS)[number], string>>) => FLAGS.forEach((k) => (v[k] ? vi.stubEnv(k, v[k]) : vi.stubEnv(k, "off")));

beforeEach(() => {
  vi.unstubAllEnvs();
  listLeadTemplates.mockReset();
  listLeadTemplates.mockResolvedValue([{ packId: "has_template" }]);
});

describe("the Lead Desk steps of the first-run checklist", () => {
  it("are given only to a business type the API lists a template for, and each only while its part of the product is on", async () => {
    flags({ LEADS_SCREENS: "1", OUTREACH_SCREENS: "1", TASK_SCREENS: "1" });
    expect(await leadDeskSteps({ packId: "has_template" })).toEqual(["lead_source_added", "call_rule_approved", "ask_assistant_tried"]);
    expect(await leadDeskSteps({ packId: "other" })).toEqual([]);
    flags({ LEADS_SCREENS: "1", TASK_SCREENS: "1" });
    expect(await leadDeskSteps({ packId: "has_template" })).toEqual(["lead_source_added", "ask_assistant_tried"]);
    flags({ LEADS_SCREENS: "1" });
    expect(await leadDeskSteps({ packId: "has_template" })).toEqual(["lead_source_added"]);
  });
  it("are none when Lead Desk is off (the template list is not even asked), when the list cannot be read, and an expired sign-in is passed on", async () => {
    flags({ OUTREACH_SCREENS: "1", TASK_SCREENS: "1" });
    expect(await leadDeskSteps({ packId: "has_template" })).toEqual([]);
    expect(listLeadTemplates).not.toHaveBeenCalled();
    flags({ LEADS_SCREENS: "1" });
    listLeadTemplates.mockRejectedValue(new ApiRequestError(503, "api_unreachable", "x"));
    expect(await leadDeskSteps({ packId: "has_template" })).toEqual([]);
    listLeadTemplates.mockRejectedValue(new ApiAuthError("x"));
    await expect(leadDeskSteps({ packId: "has_template" })).rejects.toThrow(ApiAuthError);
  });
});
