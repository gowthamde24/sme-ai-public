/** The pure checks of the Find retailers screen (job CC): no request, no server code, so the browser part can use them too. */
/** Only an address of Google Maps itself is made a link (the API reports it; the screen still checks). */
const MAPS = /^https:\/\/(www\.)?(maps\.google\.com|google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|\?|$)/;
export const mapsLink = (url: unknown): string | null => (typeof url === "string" && url.length <= 600 && MAPS.test(url) ? url : null);
export const MAX_CARDS = 10;

/** The question the assistant is asked: the router offers the map tool to a question that says "retailers" (and the city is part of the same sentence). */
export function questionOf(kind: string, city: string): string {
  const what = kind.trim();
  const where = city.trim();
  return `Find retailers: ${what}${where ? ` in ${where}` : ""}`;
}

/** The words a question to the map search may not hold: the API refuses a phone number, an e-mail address or a link in it, so the screen says so before asking. */
export function queryProblem(kind: string, city: string): "empty" | "too_long" | "contact_details" | null {
  const text = `${kind} ${city}`;
  if (kind.trim().length < 3) return "empty";
  if (kind.trim().length > 100 || city.trim().length > 60) return "too_long";
  if (/@|https?:|www\./i.test(text) || (text.match(/\d/g) ?? []).length >= 6) return "contact_details";
  return null;
}
