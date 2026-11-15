import { describe, expect, it } from "vitest";

import { bestNext } from "./next";
import type { LeadRow } from "./rows";

const row = (over: Partial<LeadRow>): LeadRow => ({ key: "l-1", kind: "lead", id: "1", name: "A", chip: "contacted", source: null, nearby: false, line: "", at: "2026-11-10T10:00:00Z", hot: false, isNew: false, phone: null, ownerUserId: null, ...over });

describe("the lead to look at first", () => {
  it("a lead ready to buy comes first, then a new one nobody has contacted, then the rest; the newest inside each", () => {
    const rows = [row({ id: "old", at: "2026-11-01T00:00:00Z" }), row({ id: "new1", isNew: true, chip: "new", at: "2026-11-09T00:00:00Z" }), row({ id: "new2", isNew: true, chip: "new", at: "2026-11-12T00:00:00Z" }), row({ id: "hot", hot: true, at: "2026-11-02T00:00:00Z" })];
    expect(bestNext(rows)).toMatchObject({ why: "hot", row: { id: "hot" } });
    expect(bestNext(rows.filter((r) => r.id !== "hot"))).toMatchObject({ why: "new", row: { id: "new2" } });
    expect(bestNext(rows.filter((r) => r.id === "old"))).toMatchObject({ why: "waiting", row: { id: "old" } });
  });
  it("skips won and lost leads and found businesses; nothing to suggest is null", () => {
    expect(bestNext([row({ chip: "won", hot: true }), row({ chip: "lost" }), row({ kind: "found", isNew: true })])).toBeNull();
    expect(bestNext([])).toBeNull();
  });
});
