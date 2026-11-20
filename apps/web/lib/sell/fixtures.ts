import { photoJson, summaryJson } from "@/lib/api/catalogue-fixtures";

import type { SampleType } from "@/lib/screens/preview";

import type { SellStyle } from "./types";

/**
 * THE FIXTURES of What you sell (JOBS=mock): made-up answers in the wire shapes `lib/api/what-you-sell.ts` reads, through the SAME parsers. PRODUCTS are rows of the REAL catalogue contract (`lib/api/catalogue-fixtures.ts`: the same fields, the same closed
 * words), plus `stock_count` (C1 contract 1.1 part 1, W3). The other four styles are C1's `GET /what-you-sell` shapes (the same contract, section 3) and every name and number is the approved mock's
 * (r3-04). Nothing here is sent or stored.
 */
type Wire = Record<string, unknown>;
const KIND = { prod: 1, serv: 2, cour: 3, prop: 4, pric: 5, draf: 6 } as const;
const id = (n: number, kind: keyof typeof KIND) => `5e11000${KIND[kind]}-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const HOST_PHOTO = (n: number) => photoJson(`0f8a927d-5555-4a55-8a55-0000000000${String(n).padStart(2, "0")}`, 1);

const PRODUCTS: Wire[] = [
  summaryJson({ id: id(1, "prod"), name: "Kanjivaram silk saree", fabric: "kanchi_pattu", fabric_label: "Kanchi pattu", colours: ["red", "green", "gold"], border: "Green border", zari: "rich", price_band: "5k_10k", price_band_label: "₹5,000 to ₹10,000", price_paise: 850_000, price_text: "₹8,500.00", stock_status: "in_stock", stock_label: "In stock", stock_count: 4 }, HOST_PHOTO(1)),
  summaryJson({ id: id(2, "prod"), name: "Mysore silk saree", fabric: "mysore_silk", fabric_label: "Mysore silk", colours: ["maroon", "green"], zari: "light", price_band: "5k_10k", price_band_label: "₹5,000 to ₹10,000", price_paise: 520_000, price_text: "₹5,200.00", stock_status: "in_stock", stock_label: "In stock", stock_count: 12 }, HOST_PHOTO(2)),
  summaryJson({ id: id(3, "prod"), name: "Pochampally ikat cotton", fabric: "pure_cotton", fabric_label: "Pure cotton", colours: ["red", "blue", "green", "yellow"], zari: "none", price_band: "under_5k", price_band_label: "Under ₹5,000", price_paise: 145_000, price_text: "₹1,450.00", stock_status: "few_left", stock_label: "Few left", stock_count: 2 }, HOST_PHOTO(3)),
  summaryJson({ id: id(4, "prod"), name: "Brocade blouse piece", fabric: "other", fabric_label: "Other", colours: ["gold"], zari: "light", price_band: "under_5k", price_band_label: "Under ₹5,000", price_paise: 65_000, price_text: "₹650.00", stock_status: "in_stock", stock_label: "In stock", stock_count: 0 }, null),
];
const SERVICES: Wire[] = [
  { id: id(1, "serv"), name: "Haircut", minutes: 30, price_paise: 20_000, price_from: false, booking: "any_day", place: null },
  { id: id(2, "serv"), name: "Facial", minutes: 45, price_paise: 70_000, price_from: false, booking: "any_day", place: null },
  { id: id(3, "serv"), name: "Hair spa", minutes: 60, price_paise: 90_000, price_from: false, booking: "not_sunday", place: null },
  { id: id(4, "serv"), name: "Bridal makeup", minutes: 180, price_paise: 600_000, price_from: true, booking: "book_ahead", place: "both" },
];
const COURSES: Wire[] = [
  { id: id(1, "cour"), name: "NEET crash course", batch: "Mon to Fri, 6 pm", starts_on: "2026-12-02", fee_paise: 2_400_000, seats: { state: "left", count: 6 }, total: 30, description: "Daily tests and a doubt class every Saturday" },
  { id: id(2, "cour"), name: "Class 10 maths", batch: "Sat and Sun, 10 am", starts_on: "2026-12-07", fee_paise: 900_000, seats: { state: "left", count: 14 }, total: null },
  { id: id(3, "cour"), name: "Spoken English", batch: "Evening batch, 7 pm", starts_on: "2026-12-01", fee_paise: 450_000, seats: { state: "full", count: null }, total: null },
];
const PROPERTIES: Wire[] = [
  { id: id(1, "prop"), name: "2 BHK flat", location: "Kukatpally", size: 1150, size_unit: "sq_ft", note: "3rd floor", price_paise: 680_000_000, status: "available" },
  { id: id(2, "prop"), name: "Plot", location: "Shamshabad", size: 200, size_unit: "sq_yd", note: "corner plot", price_paise: 1_200_000_000, status: "booked" },
  { id: id(3, "prop"), name: "3 BHK villa", location: "Gachibowli", size: 2400, size_unit: "sq_ft", note: "with garden", price_paise: 2_400_000_000, status: "sold" },
];
const PRICES: Wire[] = [
  { id: id(1, "pric"), name: "Cotton shirting 40s", moq: 50, unit: "metre", rates: [{ from_qty: 50, rate_paise: 11_800 }, { from_qty: 200, rate_paise: 11_000 }, { from_qty: 500, rate_paise: 10_400 }], good_until: "2026-12-31" },
  { id: id(2, "pric"), name: "Silk blend dupatta", moq: 24, unit: "piece", rates: [{ from_qty: 24, rate_paise: 32_000 }, { from_qty: 100, rate_paise: 29_500 }], good_until: "2026-12-31" },
  { id: id(3, "pric"), name: "Handloom towel", moq: 12, unit: "piece", rates: [{ from_qty: 12, rate_paise: 9_600 }, { from_qty: 60, rate_paise: 8_800 }, { from_qty: 240, rate_paise: 8_000 }], good_until: "2026-12-31" },
];
/** The sample businesses of the staging picker (lib/jobs/sample-fixtures.ts): the car dealer's cars (products), the real-estate agent's properties and the school's admissions (courses). No type = the saree shop's lists above. */
const CAR = { fabric: "other", fabric_label: "Other", zari: "none", border: null, occasions: [], price_band: "above_50k", price_band_label: "Above ₹50,000", stock_status: "in_stock", stock_label: "In stock" } as const;
const CARS: Wire[] = [
  summaryJson({ ...CAR, id: id(1, "prod"), name: "Compact SUV", colours: ["white", "black"], price_paise: 99_000_000, price_text: "₹9,90,000", stock_count: 3 }, null),
  summaryJson({ ...CAR, id: id(2, "prod"), name: "Family sedan", colours: ["navy", "white"], price_paise: 85_000_000, price_text: "₹8,50,000", stock_count: 5 }, null),
  summaryJson({ ...CAR, id: id(3, "prod"), name: "City hatchback", colours: ["red", "white"], price_paise: 65_000_000, price_text: "₹6,50,000", stock_status: "few_left", stock_label: "Few left", stock_count: 1 }, null),
  summaryJson({ ...CAR, id: id(4, "prod"), name: "7-seat family car", colours: ["black"], price_paise: 100_000_000, price_text: "₹10,00,000", stock_count: 0 }, null),
];
const HOMES: Wire[] = [
  { id: id(1, "prop"), name: "2BHK in Kondapur", location: "Kondapur", size: 1150, size_unit: "sq_ft", note: "3rd floor", price_paise: 680_000_000, status: "available" },
  { id: id(2, "prop"), name: "Plot in Shamshabad", location: "Shamshabad", size: 200, size_unit: "sq_yd", note: "corner plot", price_paise: 1_200_000_000, status: "booked" },
  { id: id(3, "prop"), name: "3BHK villa in Gachibowli", location: "Gachibowli", size: 2400, size_unit: "sq_ft", note: "with garden", price_paise: 2_400_000_000, status: "sold" },
];
const ADMISSIONS: Wire[] = [
  { id: id(1, "cour"), name: "Class 10 admission", batch: "Academic year 2027", starts_on: "2027-06-10", fee_paise: 6_500_000, seats: { state: "left", count: 12 }, total: 60, description: "English and Telugu medium sections" },
  { id: id(2, "cour"), name: "Class 6 admission", batch: "Academic year 2027", starts_on: "2027-06-10", fee_paise: 5_500_000, seats: { state: "left", count: 20 }, total: null },
  { id: id(3, "cour"), name: "Summer camp", batch: "April, mornings", starts_on: "2027-04-15", fee_paise: 350_000, seats: { state: "full", count: null }, total: null },
];
const OWN: Partial<Record<SampleType, Partial<Record<SellStyle, Wire[]>>>> = { cars: { products: CARS }, realestate: { properties: HOMES }, school: { courses: ADMISSIONS } };
const BY_STYLE: Record<SellStyle, Wire[]> = { products: PRODUCTS, services: SERVICES, courses: COURSES, properties: PROPERTIES, pricelist: PRICES };
const rowsOf = (style: SellStyle, type: SampleType | null): Wire[] => (type ? OWN[type]?.[style] : undefined) ?? BY_STYLE[style];

/** `GET /what-you-sell?style=` in the mock: the shop's list of that style (a sample business's own list for the staging picker). */
export function wireSell(style: SellStyle, type: SampleType | null = null): Wire {
  return { style, items: rowsOf(style, type), next_cursor: null };
}

/** What the assistant "understood" from photos or a sheet in the mock (nothing is read: two made-up entries of the style, not saved until the owner taps Save). A real shop uses the reading call (`POST /what-you-sell/{style}/read`, parsed by `parseSellReading`). */
export function wireUnderstood(style: SellStyle, from: "photos" | "sheet", type: SampleType | null = null): Wire {
  const rows = rowsOf(style, type).slice(from === "photos" ? 0 : 1, from === "photos" ? 2 : 3).map((r, i) => ({ ...r, id: id(90 + i, "draf") }));
  return { style, items: rows };
}

/** A made-up photo for the test mode: a plain coloured picture (an inline SVG) of the product's first colour, so the list can be seen without a storage service. Never used for a real shop. */
const SWATCH: Record<string, [string, string]> = { red: ["#b91c1c", "#f59e0b"], maroon: ["#7f1d3d", "#d97706"], pink: ["#db2777", "#fbcfe8"], orange: ["#ea580c", "#fde68a"], yellow: ["#eab308", "#fef3c7"], green: ["#15803d", "#bbf7d0"], blue: ["#1d4ed8", "#bfdbfe"], navy: ["#1e3a8a", "#93c5fd"], purple: ["#6d28d9", "#ddd6fe"], black: ["#1f2937", "#9ca3af"], white: ["#e5e7eb", "#ffffff"], cream: ["#f5e6c8", "#fffbeb"], gold: ["#b45309", "#fde68a"], silver: ["#9ca3af", "#e5e7eb"], brown: ["#78350f", "#d6a771"], grey: ["#6b7280", "#d1d5db"], multi: ["#0e7490", "#f59e0b"] };
export function mockPhoto(colour: string): string {
  const [a, b] = SWATCH[colour] ?? SWATCH.multi;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${a}"/><rect y="64" width="96" height="32" fill="${b}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
