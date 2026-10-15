import { describe, expect, it } from "vitest";

import { QUOTE_DETAIL_JSON } from "@/lib/api/materials-fixtures";
import { parseQuoteDetail } from "@/lib/api/materials";
import { parseTrip } from "@/lib/api/deliveries";
import { TRIP_JSON } from "@/lib/api/deliveries-fixtures";

import { addDays, dayInIndia, editable, isDay, lineRooms, notifiable, stepsFrom } from "./trip-logic";

describe("the steps", () => {
  it("each state offers only what can follow it; nothing follows delivered or cancelled", () => {
    expect(stepsFrom("planned")).toEqual(["loaded", "problem", "cancelled"]);
    expect(stepsFrom("loaded")).toEqual(["on_the_way", "problem", "planned"]);
    expect(stepsFrom("on_the_way")).toEqual(["delivered", "problem"]);
    expect(stepsFrom("problem")).toEqual(["planned", "cancelled"]);
    expect(stepsFrom("delivered")).toEqual([]);
    expect(stepsFrom("cancelled")).toEqual([]);
  });
  it("only a planned trip or a problem can be changed", () => {
    expect(["planned", "loaded", "on_the_way", "delivered", "problem", "cancelled"].filter((s) => editable(s as never))).toEqual(["planned", "problem"]);
    expect(notifiable("planned")).toBe(false);
    expect(notifiable("on_the_way")).toBe(true);
  });
});

describe("how much of each line is left", () => {
  const quote = parseQuoteDetail(QUOTE_DETAIL_JSON);
  it("counts pieces for an area line and subtracts every trip that is not cancelled", () => {
    const planned = parseTrip(TRIP_JSON);
    const cancelled = parseTrip({ ...TRIP_JSON, status: "cancelled" });
    const rooms = lineRooms(quote, [planned, cancelled], "pieces");
    expect(rooms).toEqual([{ lineNo: 1, name: "Paver block 80 mm grey (synthetic)", unit: "pieces", ordered: 4725, planned: 2500, remaining: 2225 }]);
  });
  it("never goes below zero", () => {
    const big = parseTrip({ ...TRIP_JSON, lines: [{ ...TRIP_JSON.lines[0], quantity: 9999 }] });
    expect(lineRooms(quote, [big], "pieces")[0].remaining).toBe(0);
  });
  it("a bag line counts in bags", () => {
    const bags = parseQuoteDetail({ ...QUOTE_DETAIL_JSON, lines: [{ ...QUOTE_DETAIL_JSON.lines[0], mode: "direct", sold_per: "bag", pieces: null, pallets: null, billed_quantity: 40 }] });
    expect(lineRooms(bags, [], "pieces")[0]).toMatchObject({ ordered: 40, unit: "bag" });
  });
});

describe("days", () => {
  it("is the India calendar day, not the server's", () => {
    expect(dayInIndia(Date.parse("2026-10-14T20:00:00Z"))).toBe("2026-10-15");
    expect(dayInIndia(Date.parse("2026-10-14T10:00:00Z"))).toBe("2026-10-14");
  });
  it("adds days across a month and checks a real date", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-10-14")).toBe(true);
    expect(isDay(undefined)).toBe(false);
  });
});
