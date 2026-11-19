import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getAiAssistant: vi.fn(), putAiAssistant: vi.fn(async () => undefined) }));
vi.mock("@/lib/api/ai-assistant", async (orig) => ({ ...(await orig<typeof import("@/lib/api/ai-assistant")>()), ...api }));
vi.mock("@/lib/screens/flag", async (orig) => ({ ...(await orig<typeof import("@/lib/screens/flag")>()), assistantScreens: () => "on" }));

import { clearAssistantNames, readAssistantName, saveAssistant } from "./source";
import { assistantProfile } from "./defaults";

const T = "11111111-1111-4111-8111-111111111111";
const owner = { token: "owner-token-aaaaaaaaaaaaaaaaaaaaaaaa", tenantId: T };
const member = { token: "member-token-bbbbbbbbbbbbbbbbbbbbbbbb", tenantId: T };
const answer = (name: string) => ({ saved: true, settings: { ...assistantProfile(null).defaults, name } });

beforeEach(() => {
  api.getAiAssistant.mockReset();
  clearAssistantNames();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("the assistant's name is kept 30 s per workspace and person", () => {
  it("a second read within 30 s does not ask the API again, a read after 30 s does", async () => {
    api.getAiAssistant.mockResolvedValue(answer("Vijaya"));
    expect(await readAssistantName(owner)).toBe("Vijaya");
    expect(await readAssistantName(owner)).toBe("Vijaya");
    expect(api.getAiAssistant).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    expect(await readAssistantName(owner)).toBe("Vijaya");
    expect(api.getAiAssistant).toHaveBeenCalledTimes(2);
  });
  it("a member who gets the default is not handed the owner's cached name", async () => {
    api.getAiAssistant.mockResolvedValueOnce(answer("Vijaya")).mockResolvedValueOnce(null);
    expect(await readAssistantName(owner)).toBe("Vijaya");
    expect(await readAssistantName(member)).toBeNull();
  });
  it("a rename (a save) clears the workspace's cached names in this instance", async () => {
    api.getAiAssistant.mockResolvedValueOnce(answer("Vijaya")).mockResolvedValueOnce(answer("Lakshmi"));
    expect(await readAssistantName(owner)).toBe("Vijaya");
    const input = { ...assistantProfile(null).defaults, name: "Lakshmi" };
    expect((await saveAssistant(owner, input, null)).ok).toBe(true);
    expect(await readAssistantName(owner)).toBe("Lakshmi");
  });
});
