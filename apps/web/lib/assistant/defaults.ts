import { DEFAULT_ASSISTANT_NAME } from "./name";
import type { AssistantSettings } from "./types";

/**
 * What the assistant does before anyone sets it up (job DM: "defaults per business type, so an owner can skip it"). Nothing here names a business type: the business type's MODULES decide (the same way the screens' words do).
 * A business with the programmes module (a school) never talks about dues or money on a call, because those are children's records, and has no order limit or discount to set; one with the materials module (building materials) may talk
 * about dues, because it sells on credit; every other business is the shop default. A discount is never on by default: 0 means "it may not offer one", and only the owner can raise it.
 */
export type AssistantProfile = { defaults: AssistantSettings; /** The rows of "what it may do" that this business type shows. */ mayRows: readonly ("prices" | "visits" | "whatsapp" | "dues")[]; discount: boolean; orderLimit: boolean };

const BASE: AssistantSettings = {
  name: DEFAULT_ASSISTANT_NAME,
  voice: "female_warm",
  lang: "te",
  autoSwitch: true,
  mixEnglish: true,
  style: "warm",
  speed: 1,
  may: { prices: true, visits: true, whatsapp: true, dues: false },
  maxDiscount: 0,
  handover: { owner: true, upset: true, orderAbove: null },
  hours: { from: "09:00", to: "19:00", days: ["mon", "tue", "wed", "thu", "fri", "sat"] },
};

/**
 * The settings as THIS business type may have them (job DM). A school's assistant never talks about dues, offers no discount and has no order limit, whatever a form or a cookie says: those are money and children's records
 * (the child-data rule: a child's fees and marks never go through the AI; they are filled from the school's records with fixed words). Pure; the server applies it on every read and every save, so the screen cannot be tricked.
 */
export function enforceProfile(settings: AssistantSettings, profile: AssistantProfile): AssistantSettings {
  return {
    ...settings,
    may: { ...settings.may, dues: profile.mayRows.includes("dues") ? settings.may.dues : false },
    maxDiscount: profile.discount ? settings.maxDiscount : 0,
    handover: { ...settings.handover, orderAbove: profile.orderLimit ? settings.handover.orderAbove : null },
  };
}

export function assistantProfile(modules: readonly string[] | null | undefined): AssistantProfile {
  const m = modules ?? [];
  if (m.includes("programmes"))
    return { defaults: { ...BASE, may: { prices: true, visits: true, whatsapp: true, dues: false }, handover: { ...BASE.handover } }, mayRows: ["prices", "visits", "whatsapp"], discount: false, orderLimit: false };
  if (m.includes("materials")) return { defaults: { ...BASE, lang: "hi", may: { ...BASE.may, dues: true } }, mayRows: ["prices", "visits", "whatsapp", "dues"], discount: true, orderLimit: true };
  return { defaults: BASE, mayRows: ["prices", "visits", "whatsapp", "dues"], discount: true, orderLimit: true };
}
