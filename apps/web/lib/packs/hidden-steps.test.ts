import { describe, expect, it } from "vitest";

import type { Activation } from "./activation";
import { hiddenStepsCookie, parseHidden, serializeHidden, withoutHidden } from "./hidden-steps";

const step = (check: "business_profile" | "whatsapp_connected" | "second_factor_set", state: "done" | "todo") => ({ id: check, check, title: check, hint: "", state, href: "/x" });
const ACT: Activation = { steps: [step("business_profile", "done"), step("second_factor_set", "todo"), step("whatsapp_connected", "todo")], done: 1, total: 3, next: step("second_factor_set", "todo") };

describe("the steps put away from Today", () => {
  it("keeps one cookie per workspace", () => {
    expect(hiddenStepsCookie("22222222-2222-4222-8222-222222222222")).toBe("s19_steps_off_22222222");
    expect(hiddenStepsCookie("33333333-2222-4222-8222-222222222222")).not.toBe(hiddenStepsCookie("22222222-2222-4222-8222-222222222222"));
  });
  it("reads only ids of the closed list, once each", () => {
    expect(parseHidden("second_factor_set,whatsapp_connected,second_factor_set,<script>,")).toEqual(["second_factor_set", "whatsapp_connected"]);
    expect(parseHidden(undefined)).toEqual([]);
    expect(serializeHidden(["whatsapp_connected", "whatsapp_connected"])).toBe("whatsapp_connected");
  });
  it("takes a hidden step out of Today and works the count and the next step out again; a done step is never hidden", () => {
    const shown = withoutHidden(ACT, ["second_factor_set", "business_profile"]);
    expect(shown.steps.map((s) => s.check)).toEqual(["business_profile", "whatsapp_connected"]);
    expect(shown).toMatchObject({ done: 1, total: 2 });
    expect(shown.next?.check).toBe("whatsapp_connected");
  });
  it("with every step to do hidden, nothing is left to do (the card is not drawn)", () => {
    const shown = withoutHidden(ACT, ["second_factor_set", "whatsapp_connected"]);
    expect(shown).toMatchObject({ done: 1, total: 1, next: null });
  });
});
