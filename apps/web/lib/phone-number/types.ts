/**
 * Settings > Phone number (job B6, ADR 0120): a business gets its own number inside Stack19. The steps (ADR 0120 "What would be built"): pick a city, the number is reserved, the business's KYC steps run at the provider (we keep only their STATUS, never a document), then the number is active and can ring the
 * owner's own phone as a test. Until C1's API exists this is a TEST screen (PHONE_NUMBER_SCREENS=mock): the state lives in one cookie of the browser, the numbers are made-up (+00 ...), nothing is bought, rented, rung or sent. Pure: no fetch, no React.
 */
export const CITIES = ["hyderabad", "bengaluru", "chennai", "mumbai"] as const;
export type City = (typeof CITIES)[number];
export const STEPS = ["business_proof", "owner_id"] as const;
export type Step = (typeof STEPS)[number];
export type PhoneState = "not_set_up" | "kyc_pending" | "active";
export type PhoneNumber = { state: PhoneState; city: City | null; /** A made-up number in the test screen (always +00 ...). null until one is reserved. */ number: string | null; done: Step[] };

export const NOTHING: PhoneNumber = { state: "not_set_up", city: null, number: null, done: [] };
/** The made-up number of a city (the test screen's pool): +00 then the city's code. Never a real number. */
export const MOCK_NUMBER: Record<City, string> = { hyderabad: "+00 040 0000 0101", bengaluru: "+00 080 0000 0102", chennai: "+00 044 0000 0103", mumbai: "+00 022 0000 0104" };

export const isCity = (v: unknown): v is City => typeof v === "string" && (CITIES as readonly string[]).includes(v);
export const isStep = (v: unknown): v is Step => typeof v === "string" && (STEPS as readonly string[]).includes(v);

/** What the cookie may hold: checked on every read, never trusted. A state that does not add up is "not set up". */
export function parsePhone(v: unknown): PhoneNumber | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.state === "not_set_up") return NOTHING;
  if ((o.state !== "kyc_pending" && o.state !== "active") || !isCity(o.city) || !Array.isArray(o.done)) return null;
  const done = STEPS.filter((s) => (o.done as unknown[]).includes(s));
  if (o.state === "active" && done.length !== STEPS.length) return null;
  return { state: o.state, city: o.city, number: MOCK_NUMBER[o.city], done };
}
