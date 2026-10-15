import { groupIndian } from "@/lib/money";

/** A whole number with the Indian grouping, or "0" for anything that is not one. */
export const groupIndianSafe = (n: number): string => (Number.isFinite(n) ? groupIndian(n) : "0");
