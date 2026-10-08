import { BRAND_NAME, BRAND_TEXT } from "@/design/brand";

export type Vars = Record<string, string | number>;

/**
 * Replaces {name}-style placeholders. {brand} is the product name set for running text (with the invisible joiner) and
 * {year} the current year; an unknown placeholder stays visible so it is noticed, not hidden.
 */
export function fill(template: string, vars: Vars = {}): string {
  const all: Vars = { brand: BRAND_TEXT, year: new Date().getFullYear(), ...vars };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in all ? String(all[k]) : m));
}

/** For the browser tab title and the page description: plain text, without the invisible word joiners. */
export function fillPlain(template: string, vars: Vars = {}): string {
  return fill(template, { brand: BRAND_NAME, ...vars }).replaceAll("⁠", "");
}
