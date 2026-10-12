import { describe, expect, it } from "vitest";

import type { OutboxMessage } from "@/lib/api/outbox";
import { visit } from "@/lib/api/visits-fixtures";

import { VISIT_CAP, approvalFigure, median, sareeFigures, visitFigures, weekRange } from "./week";

const msg = (over: Record<string, unknown>) => ({ id: "m", reason: "auto_allowed", created_at: "2026-10-12T04:00:00Z", decided_at: null, media: [], ...over }) as unknown as OutboxMessage;

describe("the India week", () => {
  it("is Monday to Sunday around today, read in India time", () => {
    // Wednesday 14 October 2026, 10:00 in India
    expect(weekRange(Date.parse("2026-10-14T04:30:00Z"))).toEqual({ from: "2026-10-12", to: "2026-10-18", today: "2026-10-14" });
  });
  it("a Monday is the first day, a Sunday the last", () => {
    expect(weekRange(Date.parse("2026-10-12T00:30:00+05:30")).from).toBe("2026-10-12");
    expect(weekRange(Date.parse("2026-10-18T23:30:00+05:30"))).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("uses the India date, not the server's: late Sunday night in UTC is already Monday in India", () => {
    expect(weekRange(Date.parse("2026-10-18T19:00:00Z"))).toMatchObject({ from: "2026-10-19", today: "2026-10-19" });
  });
  it("crosses a month and a year", () => {
    expect(weekRange(Date.parse("2026-12-31T10:00:00+05:30"))).toMatchObject({ from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("visit figures", () => {
  const from = "2026-10-12";
  it("counts booked (not cancelled), came, bought, did not come, cancelled and each day", () => {
    const f = visitFigures(
      [
        visit({ status: "booked", date: "2026-10-12" }),
        visit({ status: "confirmed", date: "2026-10-12" }),
        visit({ status: "arrived", date: "2026-10-13" }),
        visit({ status: "completed", outcome: "bought", date: "2026-10-14" }),
        visit({ status: "completed", outcome: "will_return", date: "2026-10-14" }),
        visit({ status: "no_show", date: "2026-10-18" }),
        visit({ status: "cancelled", date: "2026-10-15" }),
      ],
      { from },
    );
    expect(f).toMatchObject({ booked: 6, arrived: 3, bought: 1, noShow: 1, cancelled: 1, capped: false });
    expect(f.perDay).toEqual([2, 1, 2, 0, 0, 0, 1]);
  });
  it("a week with nothing is zeros, not an error", () => {
    expect(visitFigures([], { from })).toMatchObject({ booked: 0, arrived: 0, bought: 0, capped: false });
  });
  it("says when the list was full", () => {
    expect(visitFigures(Array.from({ length: VISIT_CAP }, () => visit({ date: "2026-10-13" })), { from }).capped).toBe(true);
  });
  it("ignores a visit dated outside the week in the per-day chart", () => {
    expect(visitFigures([visit({ date: "2026-10-25" })], { from }).perDay).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("how fast a person says OK", () => {
  it("is the median of made-to-approved minutes, over the messages a person approved only", () => {
    const f = approvalFigure([
      msg({ reason: "owner_approved", created_at: "2026-10-12T04:00:00Z", decided_at: "2026-10-12T04:10:00Z" }),
      msg({ reason: "owner_approved", created_at: "2026-10-12T04:00:00Z", decided_at: "2026-10-12T05:00:00Z" }),
      msg({ reason: "owner_approved", created_at: "2026-10-12T04:00:00Z", decided_at: "2026-10-12T04:20:00Z" }),
      msg({ reason: "auto_allowed", created_at: "2026-10-12T04:00:00Z", decided_at: "2026-10-12T04:00:01Z" }),
      msg({ reason: "owner_approved", created_at: "2026-10-12T04:00:00Z", decided_at: null }),
    ]);
    expect(f).toEqual({ medianMinutes: 20, count: 3 });
  });
  it("is null when nothing was approved by a person, and ignores a time that runs backwards", () => {
    expect(approvalFigure([msg({}), msg({ reason: "owner_approved", created_at: "2026-10-12T05:00:00Z", decided_at: "2026-10-12T04:00:00Z" })])).toBeNull();
  });
  it("median of an even count is the middle pair's mean", () => {
    expect(median([1, 3])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("the sarees sent most", () => {
  const items = [
    { id: "i1", name: "Kanchi Red", cover: { id: "p1" } },
    { id: "i2", name: "Mysore Blue", cover: { id: "p2" } },
    { id: "i3", name: "No Cover", cover: null },
  ] as unknown as Parameters<typeof sareeFigures>[1];
  const photos = (...ids: string[]) => ids.map((photo_id, position) => ({ photo_id, position, thumb_url: null }));
  it("counts a saree once for each message that shows its cover, most first", () => {
    const f = sareeFigures([msg({ media: photos("p1") }), msg({ media: photos("p2", "p1") }), msg({ media: photos("p1", "p1") }), msg({})], items);
    expect(f.top).toEqual([
      { id: "i1", name: "Kanchi Red", count: 3 },
      { id: "i2", name: "Mysore Blue", count: 1 },
    ]);
    expect(f).toMatchObject({ unmatched: 0, withPhotos: 3 });
  });
  it("says how many messages with photos matched no saree, and counts no text-only message", () => {
    const f = sareeFigures([msg({ media: photos("zzz") }), msg({})], items);
    expect(f).toEqual({ top: [], unmatched: 1, withPhotos: 1 });
  });
  it("keeps the top five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, name: `S${i}`, cover: { id: `p${i}` } })) as unknown as Parameters<typeof sareeFigures>[1];
    expect(sareeFigures(many.map((_, i) => msg({ media: photos(`p${i}`) })), many).top).toHaveLength(5);
  });
});
