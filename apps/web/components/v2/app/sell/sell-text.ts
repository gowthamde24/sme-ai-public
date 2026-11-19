import { bigMoneyText, groupedNumber, rupeeText, shortDay, SHORT_UNIT, SIZE_SHORT } from "@/lib/sell/text";
import type { QtyUnit, SellEntry } from "@/lib/sell/types";

import type { JobTone } from "../ds/JobChip";
import type { Say } from "../words";

/**
 * The words of one entry in the list (pure: the row, the "I understood" card and the tests use it). Every sentence is `jobs.sell.*`; money, numbers and the units "sq ft" and "kg" are written as they are in every language.
 * Stock and sale status are neutral chips, except Booked = amber (waiting) and Sold = green (done) (owner-approved mock r3-04, choice 4).
 */
export type EntryText = { title: string; line: string; price: string; chip: { tone: JobTone; text: string } | null; rates: string[] };

const plural = (t: Say, base: string, n: number): string => (n === 1 ? t(`${base}.one`) : t(`${base}.n`, { n }));
export function minutesText(t: Say, minutes: number): string {
  if (minutes % 60 === 0) return minutes === 60 ? t("jobs.sell.hour") : t("jobs.sell.hours", { n: minutes / 60 });
  return t("jobs.sell.minutes", { n: minutes });
}
const unitWord = (t: Say, u: QtyUnit, n: number): string => (n === 1 ? t(`jobs.sell.unit.${u}.one`) : t(`jobs.sell.unit.${u}`));
/** The short word of a unit in a rate ("50 m+"); a piece has none ("24+"). */
export const shortUnit = (u: QtyUnit): string => SHORT_UNIT[u];
export const rateLabel = (t: Say, u: QtyUnit, qty: number): string => {
  const short = shortUnit(u);
  return `${groupedNumber(qty)}${short ? ` ${short}` : ""}+`;
};

export function entryText(t: Say, e: SellEntry): EntryText {
  switch (e.style) {
    case "products": {
      const names = e.colours.map((c) => t(`catalogue.colour.${c}`)).join(", ");
      const s = e.stock;
      const chip = { tone: "info" as const, text: s.state === "sold_out" ? t("jobs.sell.stock.sold_out") : s.state === "made_to_order" ? t("jobs.sell.stock.made_to_order") : s.count !== null ? t(s.state === "few_left" ? "jobs.sell.stock.left" : "jobs.sell.stock.in", { n: s.count }) : t(s.state === "few_left" ? "jobs.sell.stock.few_left" : "jobs.sell.stock.in_stock") };
      return { title: e.name, line: `${plural(t, "jobs.sell.colour", e.colours.length)}${names ? ` · ${names}` : ""}`, price: e.pricePaise !== null ? rupeeText(e.pricePaise) : "", chip, rates: [] };
    }
    case "services":
      return {
        title: e.name,
        line: [minutesText(t, e.minutes), e.place ? t(`jobs.sell.place.${e.place}`) : ""].filter(Boolean).join(" · "),
        price: e.priceFrom ? t("jobs.sell.from", { price: rupeeText(e.pricePaise) }) : rupeeText(e.pricePaise),
        chip: { tone: "info", text: t(`jobs.sell.booking.${e.booking}`) },
        rates: [],
      };
    case "courses": {
      const date = shortDay(e.startsOn);
      return {
        title: e.name,
        line: date ? t("jobs.sell.course.line", { batch: e.batch, date }) : e.batch,
        price: e.feePaise === null ? "" : rupeeText(e.feePaise),
        chip: e.seats.state === "full" ? { tone: "info", text: t("jobs.sell.seats.full") } : e.seats.state === "left" && e.seats.count !== null ? { tone: "info", text: t("jobs.sell.seats.left", { n: e.seats.count }) } : null,
        rates: [],
      };
    }
    case "properties":
      return {
        title: `${e.name}, ${e.location}`,
        line: [`${groupedNumber(e.size)} ${SIZE_SHORT[e.sizeUnit]}`, e.note ?? ""].filter(Boolean).join(" · "),
        price: bigMoneyText(e.pricePaise),
        chip: { tone: e.status === "booked" ? "wait" : e.status === "sold" ? "done" : "info", text: t(`jobs.sell.status.${e.status}`) },
        rates: [],
      };
    case "pricelist":
      return {
        title: e.name,
        line: t("jobs.sell.moq", { n: groupedNumber(e.moq), unit: unitWord(t, e.unit, e.moq) }),
        price: "",
        chip: null,
        rates: e.rates.map((r) => `${rateLabel(t, e.unit, r.fromQty)} ${rupeeText(r.ratePaise)}`),
      };
  }
}
