/**
 * GSTIN, the GST registration number, checked for FORM only (job CC, screen 6; the same rule as services/ai-api/app/gstin.py and the database's app.gstin_is_valid, which stay the authority). Pure and offline: it can say a number is
 * well formed, never that the business exists or is active. 15 characters: a state code (01 to 38, 97 or 99), the holder's PAN (five letters, four digits, one letter), an entity number (1 to 9, then A to Z), the letter Z, and a
 * check character (Luhn mod 36 over the first 14). Safe for the browser: no request, no dictionary.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPE = /^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const STATE_NAMES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh (before 2014)", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

/** What a person typed with spaces and dashes taken out and capitals; "" when there is nothing. */
export const normaliseGstin = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

/** The 15th character for the first 14 (alphanumeric capitals). */
export function checkCharacter(first14: string): string {
  let total = 0;
  let factor = 2;
  for (let i = first14.length - 1; i >= 0; i -= 1) {
    const product = ALPHABET.indexOf(first14[i]) * factor;
    total += Math.floor(product / 36) + (product % 36);
    factor = 3 - factor;
  }
  return ALPHABET[(36 - (total % 36)) % 36];
}

export const isValidGstin = (gstin: string): boolean => SHAPE.test(gstin) && checkCharacter(gstin.slice(0, 14)) === gstin[14];

export type GstinProblem = "length" | "shape" | "check";
/** null when the text is a good GSTIN (or empty: empty means "none", which is allowed); else what is wrong, in the order a person fixes it. */
export function gstinProblem(raw: string): GstinProblem | null {
  const g = normaliseGstin(raw);
  if (g === "") return null;
  if (g.length !== 15) return "length";
  if (!SHAPE.test(g)) return "shape";
  return checkCharacter(g.slice(0, 14)) === g[14] ? null : "check";
}

/** The state or territory a GSTIN's first two digits name, or null. */
export const stateOfGstin = (gstin: string): string | null => STATE_NAMES[gstin.slice(0, 2)] ?? null;
