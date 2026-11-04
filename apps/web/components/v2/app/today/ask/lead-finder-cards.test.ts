import { describe, expect, it } from "vitest";

import { parseSearch } from "@/lib/api/lead-finder-card";
import { SEARCH_DONE, SEARCH_PLANNED } from "@/lib/api/lead-finder-fixtures";

import { finderCards } from "./lead-finder-cards";

describe("one card per search in the thread", () => {
  const planned = parseSearch(SEARCH_PLANNED);
  const done = parseSearch(SEARCH_DONE);
  const other = { ...planned, id: "a1a1a1a1-0000-4000-8000-000000000009" };
  it("the reply that first showed a search draws it, with the furthest state seen; a later reply of the same search (the yes turn, a replay) draws nothing more", () => {
    expect(finderCards([null, { search: planned, canApprove: true }, undefined, { search: done, canApprove: true }])).toEqual([null, { search: done, canApprove: true }, null, null]);
    expect(finderCards([{ search: done, canApprove: true }, { search: planned, canApprove: true }])).toEqual([{ search: done, canApprove: true }, null]); // a replayed plan never takes a done card back
    expect(finderCards([{ search: planned, canApprove: true }, { search: other, canApprove: false }])).toEqual([{ search: planned, canApprove: true }, { search: other, canApprove: false }]);
  });
  it("the card's own OK or Cancel moves it on in place; it never goes back", () => {
    expect(finderCards([{ search: planned, canApprove: true }], { [planned.id]: done })).toEqual([{ search: done, canApprove: true }]);
    expect(finderCards([{ search: done, canApprove: true }], { [planned.id]: planned })).toEqual([{ search: done, canApprove: true }]);
    expect(finderCards([null], { [planned.id]: done })).toEqual([null]); // nothing to draw where no reply showed it
  });
});
