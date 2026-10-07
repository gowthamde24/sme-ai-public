/** Money formatting. Amounts are rupees in, Indian digit grouping out (₹1,42,000). Used only for labelled examples on the public page. */
export type Decimals = "auto" | 0 | 2;

/**
 * formatINR(142000) -> "₹1,42,000"
 * formatINR(7820, { decimals: 2 }) -> "₹7,820.00"  (exact money, e.g. money still held)
 * "auto" shows paise only when the amount has them.
 */
export function formatINR(amount: number, opts: { decimals?: Decimals } = {}): string {
  const mode = opts.decimals ?? "auto";
  const digits = mode === "auto" ? (Number.isInteger(amount) ? 0 : 2) : mode;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
