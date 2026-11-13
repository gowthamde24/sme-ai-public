import type { LegalText } from "./types";

/**
 * The Refund and Cancellation Policy: a DRAFT written by C2 on 13 Nov 2026 for the owner to approve (the owner's block D13; "legal and privacy texts stay drafts until I approve"). Every money term below is C2's RECOMMENDATION, decided under the standing rule and marked for the owner to
 * confirm or change: the 14-day window to ask, what is refundable, how a refund is paid. The page carries the "Draft, pending legal review" banner whatever LEGAL_IS_DRAFT says (lib/legal/version.ts, DRAFT_DOC_IDS) and is reachable only where LEGAL_DRAFT_PAGES is on (staging). English only.
 */
export const REFUND: LegalText = {
  title: "Refund and Cancellation Policy",
  intro: [
    "This policy says when you can cancel {brand}, what happens to your money when you do, and when we refund. It is part of the Terms of Use. {business_description} (\"we\", \"us\") is the seller. Our prices are shown, with GST, before we charge you anything.",
  ],
  sections: [
    {
      id: "trial",
      title: "1. The free trial",
      blocks: [
        { p: "A new workspace has a free trial of {trial_days} days, counted from the day its WhatsApp is connected. Nothing is charged during the trial. If you cancel during the trial, you are never charged." },
      ],
    },
    {
      id: "cancel",
      title: "2. Cancelling a paid plan",
      blocks: [
        {
          ul: [
            "You can cancel at any time: in the app under Settings, Plan, or by writing to {billing} from the e-mail address of your account. We confirm by e-mail.",
            "A cancelled plan stays active until the end of the period you already paid for. We do not charge you again after that.",
            "When a plan ends, the workspace becomes read-only: you can still sign in, look at your records, export them and ask for deletion. We keep the data for {lapsed_days} days, e-mail you {erasure_warning_hours} hours before erasing it, and then erase it.",
          ],
        },
      ],
    },
    {
      id: "refunds",
      title: "3. When we refund",
      blocks: [
        { p: "A period you have already used is not refunded, because the service has been delivered. We do refund in these cases:" },
        {
          ul: [
            "You were charged by mistake, or twice for the same period.",
            "You cancelled before the renewal date and were charged anyway.",
            "The service could not be used for a long time because of a fault on our side. We refund the affected part of that period, in proportion.",
          ],
        },
        { p: "Ask within 14 days of the charge, by writing to {billing} with the e-mail address of your account and the date of the charge. We answer within {request_days} days." },
      ],
    },
    {
      id: "topups",
      title: "4. Extra minutes and messages (top-ups)",
      blocks: [
        { p: "A top-up that has been used, even in part, is not refunded. A top-up that was charged by mistake, or that you have not used at all, is refunded if you ask within 7 days of buying it." },
      ],
    },
    {
      id: "paid",
      title: "5. How a refund is paid",
      blocks: [
        { p: "A refund goes back to the payment method you paid with, through our payment provider, usually within 7 working days of our approving it. Your bank or card issuer may take longer to show it. The refund includes the GST on the amount refunded, and we send you a credit note." },
      ],
    },
    {
      id: "failed",
      title: "6. A payment that fails",
      blocks: [
        { p: "If a renewal payment fails, our payment provider tries again on its own schedule and we e-mail you. If it still fails, the workspace becomes read-only until you pay. There is no penalty fee." },
      ],
    },
    {
      id: "contact",
      title: "7. Contact",
      blocks: [
        { p: "Questions about a payment, an invoice or a refund: {billing}. General help: {support}. {business_description}." },
      ],
    },
  ],
};
