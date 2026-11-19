import type { Prospect } from "@/lib/lead-finder/types";

/** One line of facts per card: what it is, where, the rating and the number of reviews (distance only once the API gives one). */
export function facts(p: Pick<Prospect, "category" | "area" | "rating" | "reviewCount">, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const parts = [p.category, p.area, p.rating !== null ? `★ ${p.rating.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : null, p.reviewCount !== null ? t("lf.reviews", { n: p.reviewCount.toLocaleString("en-IN") }) : null];
  return parts.filter((x): x is string => typeof x === "string" && x !== "").join(" · ");
}
