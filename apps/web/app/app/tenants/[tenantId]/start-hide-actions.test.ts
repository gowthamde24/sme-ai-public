import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const get = vi.fn();
const revalidatePath = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => get(n), set: (...a: unknown[]) => set(...a) }) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({}) }));

import { setStepHiddenAction } from "./start-hide-actions";

const T = "22222222-2222-4222-8222-222222222222";
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  get.mockReturnValue(undefined);
});

describe("Finish setting up: putting a step away", () => {
  it("adds the step to this workspace's cookie and reads the pages again", async () => {
    get.mockReturnValue({ value: "whatsapp_connected" });
    await setStepHiddenAction(T, form({ step: "second_factor_set" }));
    expect(set).toHaveBeenCalledWith("s19_steps_off_22222222", "whatsapp_connected,second_factor_set", expect.objectContaining({ path: "/app", sameSite: "lax" }));
    expect(revalidatePath).toHaveBeenCalledWith(`/app/tenants/${T}`, "layout");
  });
  it("brings it back with do=show", async () => {
    get.mockReturnValue({ value: "whatsapp_connected,second_factor_set" });
    await setStepHiddenAction(T, form({ step: "second_factor_set", do: "show" }));
    expect(set).toHaveBeenCalledWith("s19_steps_off_22222222", "whatsapp_connected", expect.anything());
  });
  it("a step that is not on the closed list, or a bad workspace id, does nothing", async () => {
    await setStepHiddenAction(T, form({ step: "drop_table" }));
    await setStepHiddenAction("nope", form({ step: "second_factor_set" }));
    expect(set).not.toHaveBeenCalled();
  });
});
