import { permanentRedirect } from "next/navigation";

/**
 * /refund-policy used to show the longer legal draft (owner's D13). There is ONE refund page now: /refunds (launch public pages, 29 Nov 2026; planner decision: 14 days for unused credits from the day of purchase, credits never expire,
 * refunds only for unused credits, to the original payment method, by writing to hello@). The old address leads there, so no link or bookmark breaks. The legal text (lib/legal/refund-text.ts) stays in the repository for the lawyer's review.
 */
export default function RefundPolicyPage(): never {
  permanentRedirect("/refunds");
}
