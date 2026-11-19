import { COLOURS, type Colour } from "@/lib/api/catalogue";

import { EMPTY } from "./forms";
import type { PropertyStatus, QtyUnit, SellForm, SellStyle, SizeUnit } from "./types";

/**
 * "Say it" (and typing it): what a plain sentence of the owner means for the five styles, found by CLOSED words and numbers only (no model, nothing sent anywhere): "Kanjivaram silk saree, 8,500 rupees, red and green, 4 in stock." Words it does not find stay empty
 * and the sheet asks for them; nothing is saved from here, the owner always sees the "I understood" card first. The assistant's own reading of longer talk, photos and sheets is C1's (what-you-sell-web-needs.md, question 4); this keeps the button honest meanwhile.
 */
const num = (s: string): string => s.replace(/,/g, "");
const first = (re: RegExp, text: string): RegExpExecArray | null => re.exec(text);
/** The name: what comes before the first comma, number or little word that starts the rest ("takes", "costs", "in", "for"). */
function nameOf(text: string): string {
  const head = text.split(/[,;.]|\b(?:takes|costs?|is|for|at)\b/i)[0] ?? "";
  return head.replace(/\s+/g, " ").trim().slice(0, 120);
}
const MONEY = /(?:₹|\brs\.?)\s*(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:rupees|rupee|rs\b|₹)/i;
const moneyOf = (text: string): string => {
  const m = first(MONEY, text);
  return m ? num(m[1] ?? m[2] ?? "") : "";
};
const UNITS: [RegExp, QtyUnit][] = [[/\bmetres?\b|\bmeters?\b|\bm\b/i, "metre"], [/\bkg\b|\bkilos?\b/i, "kg"], [/\bsets?\b/i, "set"], [/\bdozens?\b/i, "dozen"], [/\bpieces?\b|\bpcs\b/i, "piece"]];

export function understand<S extends SellStyle>(style: S, raw: string): SellForm[S] {
  const text = raw.replace(/\s+/g, " ").trim();
  const f = structuredClone(EMPTY[style]) as SellForm[SellStyle];
  const name = nameOf(text);
  if (style === "products") {
    const p = f as SellForm["products"];
    p.name = name;
    p.price = moneyOf(text);
    const low = text.toLowerCase();
    p.colours = (COLOURS as readonly Colour[]).filter((c) => new RegExp(`\\b${c}\\b`).test(low)).slice(0, 4);
    const c = first(/(\d[\d,]*)\s+(?:pieces?\s+)?in stock/i, text) ?? first(/\bhave\s+(\d[\d,]*)\b/i, text);
    if (c) p.count = num(c[1]);
    if (/few left|only a few/i.test(text)) p.stock = "few_left";
    else if (/made to order|on order/i.test(text)) p.stock = "made_to_order";
  } else if (style === "services") {
    const s = f as SellForm["services"];
    s.name = name;
    s.price = moneyOf(text);
    s.priceFrom = /\bfrom\b/i.test(text);
    const h = first(/(\d+(?:\.\d)?)\s*(?:hours?|hrs?)\b/i, text);
    const m = first(/(\d+)\s*(?:minutes?|mins?)\b/i, text);
    if (h) s.minutes = String(Math.round(Number(h[1]) * 60));
    else if (m) s.minutes = m[1];
    if (/not (?:on )?sunday|except sunday/i.test(text)) s.booking = "not_sunday";
    else if (/book ahead|advance/i.test(text)) s.booking = "book_ahead";
    if (/\bat home\b|home visit/i.test(text)) s.place = "at_home";
  } else if (style === "courses") {
    const c = f as SellForm["courses"];
    c.name = name;
    c.fee = moneyOf(text);
    const b = first(/((?:mon|tue|wed|thu|fri|sat|sun|evening|morning|weekend)[a-z ]*?,?\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)))/i, text);
    if (b) c.batch = b[1].trim().replace(/^./, (x) => x.toUpperCase());
    const seats = first(/(\d+)\s*seats?/i, text);
    if (seats) c.seats = seats[1];
  } else if (style === "properties") {
    const p = f as SellForm["properties"];
    const inAt = first(/^(.*?)\s+in\s+([^,.;]+)/i, text);
    if (inAt) {
      p.name = inAt[1].trim().slice(0, 120);
      p.location = inAt[2].trim().slice(0, 120);
    } else p.name = name;
    const sz = first(/([\d,]+)\s*(sq\.?\s?ft|sqft|sq\.?\s?yd|sqyd|acres?|cents?)\b/i, text);
    if (sz) {
      p.size = num(sz[1]);
      const u = sz[2].toLowerCase().replace(/[.\s]/g, "");
      p.sizeUnit = (u.startsWith("sqy") ? "sq_yd" : u.startsWith("acre") ? "acre" : u.startsWith("cent") ? "cent" : "sq_ft") satisfies SizeUnit;
    }
    const money = first(/([\d.,]+)\s*(lakhs?|lacs?|crores?|cr)\b/i, text);
    p.price = money ? `${num(money[1])} ${money[2].toLowerCase().startsWith("cr") ? "crore" : "lakh"}` : moneyOf(text);
    const st: PropertyStatus | null = /\bsold\b/i.test(text) ? "sold" : /\bbooked\b/i.test(text) ? "booked" : null;
    if (st) p.status = st;
  } else {
    const p = f as SellForm["pricelist"];
    p.name = name;
    const moq = first(/(?:minimum|min|moq)(?:\s+order)?(?:\s+of)?\s*(\d[\d,]*)/i, text);
    if (moq) p.moq = num(moq[1]);
    for (const [re, unit] of UNITS) if (re.test(text)) { p.unit = unit; break; }
    const rate = moneyOf(text);
    p.rates = [{ fromQty: p.moq, rate }];
  }
  return f as SellForm[S];
}
