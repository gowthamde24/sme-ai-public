import type { MaterialQuoteDetailOut, TripOut } from "@contracts";

/**
 * Small pure helpers of the deliveries screens (job CO): which steps a trip offers from where it stands, how much of each quote line is still to be sent, and the India calendar day. The API and the database decide what
 * is allowed (a truck cannot leave before the order is dispatched; a line cannot go out more than the order holds); this only keeps the screen from offering what is plainly not possible.
 */
export type TripStatus = TripOut["status"];

/** The buttons a trip in this status offers, in order. "delivered" needs the proof, so it opens the proof sheet. */
export function stepsFrom(status: TripStatus): readonly ("loaded" | "on_the_way" | "delivered" | "problem" | "cancelled" | "planned")[] {
  switch (status) {
    case "planned":
      return ["loaded", "problem", "cancelled"];
    case "loaded":
      return ["on_the_way", "problem", "planned"];
    case "on_the_way":
      return ["delivered", "problem"];
    case "problem":
      return ["planned", "cancelled"];
    default:
      return [];
  }
}

/** A trip can be changed (date, vehicle, driver, site, quantities) while it is planned or in a problem. */
export const editable = (status: TripStatus): boolean => status === "planned" || status === "problem";
/** The site contact can be told about a trip that is on the way or done; "soon" and "delay" while it is moving. */
export const notifiable = (status: TripStatus): boolean => status === "loaded" || status === "on_the_way" || status === "delivered" || status === "problem";

export type LineRoom = { lineNo: number; name: string; unit: string; ordered: number; planned: number; remaining: number };

/** How many of each line the quote holds (pieces for an area or piece line, the sold unit otherwise) and how many the trips (not cancelled) already carry. */
export function lineRooms(quote: Pick<MaterialQuoteDetailOut, "lines">, trips: readonly Pick<TripOut, "status" | "lines">[], pcsWord: string): LineRoom[] {
  return quote.lines.map((l) => {
    const ordered = l.mode === "area" || l.sold_per === "piece" ? (l.pieces ?? l.billed_quantity) : l.billed_quantity;
    const planned = trips.filter((t) => t.status !== "cancelled").reduce((sum, t) => sum + t.lines.filter((x) => x.line_no === l.line_no).reduce((a, x) => a + x.quantity, 0), 0);
    return { lineNo: l.line_no, name: l.name, unit: l.mode === "area" || l.sold_per === "piece" ? pcsWord : l.sold_per, ordered, planned, remaining: Math.max(0, ordered - planned) };
  });
}

/** The India calendar date (YYYY-MM-DD) of an instant. */
export function dayInIndia(ms: number): string {
  return new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
export const isDay = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export const VEHICLE = /^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$/;
export const PHONE = /^[+]?[0-9][0-9 -]{6,18}$/;
export const ETA = /^[0-9]{1,2}(:[0-9]{2})?( ?[ap]m)?$/;
