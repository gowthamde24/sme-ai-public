"use server";

import { headers } from "next/headers";

import { fillPlain } from "@/i18n/fill";
import { siteT } from "@/i18n/site";
import { clientIp } from "@/lib/auth/signup-limit";
import { passesTurnstile } from "@/lib/security/turnstile";
import { consented, MAX_CITY, MAX_NAME, MAX_QUESTION, oneLine, readSiteLang, type LeadResult } from "@/lib/site/lead";
import { sharedLeadLimiter } from "@/lib/site/lead-limit";
import { SITE_PACKS, packBySlug, textIn } from "@/lib/site/packs";
import { computePaver, MAX_AREA, type AreaUnit } from "@/lib/site/paver";
import { chatAddress, ourWhatsappDigits } from "@/lib/site/whatsapp";

/**
 * The two ways to start a WhatsApp chat with us from the public site (job CM). Neither stores anything: each checks the input, counts the try against the address's hourly limit, and returns the `wa.me` address of our own
 * number with the message filled in, built HERE from checked pieces (the calculator's numbers are worked out again on the server, never taken from the browser). The visitor ticks consent first, the number is read on the
 * server only (lib/site/whatsapp.ts), and the enquiry reaches us as a WhatsApp message in our own workspace's inbox, the way a business's own customers' enquiries reach it.
 */
async function allowed(): Promise<boolean> {
  return sharedLeadLimiter().allow(clientIp(await headers()));
}

/** The contact form: a name, the kind of business (a page of the site, or "other"), an optional question, and consent. */
export async function prepareContactChat(input: unknown): Promise<LeadResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const lang = readSiteLang(raw.lang);
  if (!consented(raw.consent)) return { ok: false, error: "consent" };
  const name = oneLine(raw.name, MAX_NAME);
  if (name === null) return { ok: false, error: "name" };
  const digits = ourWhatsappDigits();
  if (digits === null) return { ok: false, error: "unavailable" };
  if (!(await allowed())) return { ok: false, error: "rate" };
  if (!(await passesTurnstile(raw.turnstileToken, clientIp(await headers())))) return { ok: false, error: "check" }; // the check box (when it is on)
  const t = siteT(lang);
  const pack = typeof raw.type === "string" ? packBySlug(raw.type) : null;
  const type = pack ? textIn(pack.names, lang) : t("contact.type.other");
  const question = oneLine(raw.question, MAX_QUESTION) ?? "";
  const url = chatAddress(digits, fillPlain(t("contact.msg", { name, type, what: question }).replace(/\s+$/, "")));
  return url ? { ok: true, url } : { ok: false, error: "invalid" };
}

/** The calculator's "Get exact quote on WhatsApp": the inputs of the calculation, a name, an optional city, and consent. The numbers in the message are the server's own. */
export async function prepareQuoteChat(input: unknown): Promise<LeadResult> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const lang = readSiteLang(raw.lang);
  if (!consented(raw.consent)) return { ok: false, error: "consent" };
  const name = oneLine(raw.name, MAX_NAME);
  if (name === null) return { ok: false, error: "name" };
  const city = oneLine(raw.city, MAX_CITY);
  const calc = SITE_PACKS.find((p) => p.calculator)?.calculator;
  const unit: AreaUnit | null = raw.unit === "sq_ft" || raw.unit === "sq_m" ? raw.unit : null;
  const area = typeof raw.area === "number" ? raw.area : Number.NaN;
  const product = calc?.products.find((p) => p.id === raw.productId);
  if (!calc || !unit || !product || !(area >= 1 && area <= MAX_AREA)) return { ok: false, error: "invalid" };
  const digits = ourWhatsappDigits();
  if (digits === null) return { ok: false, error: "unavailable" };
  if (!(await allowed())) return { ok: false, error: "rate" };
  const result = computePaver(calc, { productId: product.id, area, unit }, new Date().toISOString().slice(0, 10));
  if (!result) return { ok: false, error: "invalid" };
  const t = siteT(lang);
  const nf = new Intl.NumberFormat("en-IN");
  const text = fillPlain(
    t("calc.lead.msg", { name, area: nf.format(area), unit: t(`calc.unit.${unit}`), product: textIn(product.name, lang), pieces: nf.format(result.pieces), trips: result.trips, city: city ? t("calc.lead.cityIn", { city }) : "" }).replace(/\s+$/, ""),
  );
  const url = chatAddress(digits, text);
  return url ? { ok: true, url } : { ok: false, error: "invalid" };
}
