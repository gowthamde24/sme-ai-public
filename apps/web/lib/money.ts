/**
 * Money for the screens (jobs CO, CQ, CS): rupees with the Indian grouping from integer paise, the same text the calculator package prints (a test holds them equal), and the amount in words that a confirmation
 * sheet shows beside the figure (blueprint 8: every money action shows the amount in words). Pure and client-safe: no dictionary, no request. Nothing here calculates a price; it only writes down a number it was given.
 */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toString();
  const fraction = String(abs % 100).padStart(2, "0");
  const grouped = whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`;
  return `${negative ? "-" : ""}₹${grouped}.${fraction}`;
}

/** The same without the paise when there are none: 8879500 -> "₹88,795", 8879550 -> "₹88,795.50". */
export function formatRupeesShort(paise: number): string {
  const full = formatRupees(paise);
  return full.endsWith(".00") ? full.slice(0, -3) : full;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** A whole number in the Indian system (thousand, lakh, crore), in English: 8879500 -> "Eighty-Eight Lakh Seventy-Nine Thousand Five Hundred". Zero is "Zero". Up to 99,999 crore. */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("a whole number of zero or more");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  let rest = n;
  const crore = Math.floor(rest / 10_000_000);
  rest %= 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (crore) parts.push(`${crore >= 100 ? numberInWords(crore) : below100(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** An amount in words for a confirmation: 8879550 -> "Rupees Eighty-Eight Thousand Seven Hundred Ninety-Five and Fifty Paise Only". English in every language (a native reader has not checked number words yet). */
export function rupeesInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError("an amount of zero or more");
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${numberInWords(rupees)}${rest ? ` and ${below100(rest)} Paise` : ""} Only`;
}

/** Basis points as a percent for people: 1800 -> "18", 250 -> "2.5". */
export function percentFromBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Hundredths of an area unit as text: 100000 -> "1,000", 12550 -> "125.5". */
export function areaText(x100: number): string {
  const whole = Math.floor(x100 / 100);
  const frac = x100 % 100;
  const grouped = whole.toString().length <= 3 ? String(whole) : `${whole.toString().slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.toString().slice(-3)}`;
  return frac === 0 ? grouped : `${grouped}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** Whole numbers with the Indian grouping: 4725 -> "4,725", 1250000 -> "12,50,000". */
export function groupIndian(n: number): string {
  const s = Math.abs(Math.trunc(n)).toString();
  const g = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
  return n < 0 ? `-${g}` : g;
}

/** Typed rupees ("1,250.50", "₹ 900") to integer paise, or null when it is not an amount of at most two decimals within the bound. */
export function rupeesToPaise(text: string, maxPaise = 100_000_000_000): number | null {
  const t = text.replace(/[₹,\s]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  const paise = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise <= maxPaise ? paise : null;
}
