import { describe, expect, it, vi } from "vitest";

import { parseSearch } from "@/lib/api/lead-finder-card";
import { SEARCH_DONE, SEARCH_PLANNED } from "@/lib/api/lead-finder-fixtures";

import { decideSearch, openHistory } from "./conversation-api";

const B = "/app/tenants/t";
const answering = (json: unknown) => vi.fn(async () => ({ ok: true, json: async () => json }) as unknown as Response);
const done = parseSearch(SEARCH_DONE);

describe("the Lead Finder card's side calls (docs/contracts/lead-finder.md 1b)", () => {
  it("OK and Cancel go to this workspace's own route with the search's id; the answer is the card's new search", async () => {
    const f = answering({ ok: true, search: done });
    expect(await decideSearch(B, done.id, "approve", f)).toEqual({ ok: true, search: done });
    expect(f).toHaveBeenCalledWith(`${B}/conversation`, expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ op: "lf_approve", searchId: done.id }) }));
    const c = answering({ ok: true, search: { ...done, state: "cancelled" } });
    expect(await decideSearch(B, done.id, "cancel", c)).toMatchObject({ ok: true, search: { state: "cancelled" } });
    expect(c).toHaveBeenCalledWith(`${B}/conversation`, expect.objectContaining({ body: JSON.stringify({ op: "lf_cancel", searchId: done.id }) }));
  });
  it("a refusal is a closed word; another search's answer, an odd one or a failed request is `down`", async () => {
    for (const e of ["cap", "state", "off", "forbidden"] as const) expect(await decideSearch(B, done.id, "approve", answering({ ok: false, error: e }))).toEqual({ ok: false, error: e });
    expect(await decideSearch(B, done.id, "approve", answering({ ok: false, error: "weird" }))).toEqual({ ok: false, error: "down" });
    expect(await decideSearch(B, done.id, "approve", answering({ ok: true, search: { ...done, id: "a1a1a1a1-0000-4000-8000-000000000009" } }))).toEqual({ ok: false, error: "down" });
    expect(await decideSearch(B, done.id, "approve", answering({ ok: true, search: { id: done.id } }))).toEqual({ ok: false, error: "down" });
    expect(await decideSearch(B, done.id, "approve", vi.fn(async () => ({ ok: false }) as unknown as Response))).toEqual({ ok: false, error: "down" });
  });
  it("a conversation opened from the history keeps the card on the reply that showed it, with its state now; a card that is off is left out", async () => {
    const card = { search: done, canApprove: true };
    const thread = await openHistory(
      B,
      "c",
      answering({
        messages: [
          { role: "user", text: "find new retailers in Jayanagar" },
          { role: "assistant", text: "Shall I search?", kind: "answer", action: null, sources: [], leadFinder: card },
          { role: "user", text: "hello" },
          { role: "assistant", text: "Hello!", kind: "answer", action: null, sources: [], leadFinder: { search: parseSearch(SEARCH_PLANNED) } },
        ],
      }),
    );
    expect(thread?.map((x) => [x.asked, x.answer, x.leadFinder ?? null])).toEqual([
      ["find new retailers in Jayanagar", "Shall I search?", card],
      ["hello", "Hello!", null],
    ]);
  });
});
