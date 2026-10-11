import type { LegalText } from "./types";

/**
 * The Terms of Use (job BH). Plain English for a shop owner. DRAFT, pending legal review (lib/legal/version.ts). [CAPITALISED BRACKETS] are for the owner to fill; `[CONFIRM: ...]` marks a decision only
 * the owner or a lawyer can make. It describes the service as built: an AI assistant that reads a business's records and prepares drafts, with a person approving anything risky.
 */
export const TERMS: LegalText = {
  title: "Terms of Use",
  intro: [
    "These terms are the agreement between you and [COMPANY NAME], [ADDRESS] (\"we\", \"us\") for using {brand}. By ticking the box when you sign up, you agree to them and to the Privacy Policy. If you use {brand} for a business, you confirm that you may agree on its behalf.",
  ],
  sections: [
    {
      id: "service",
      title: "1. What {brand} is",
      blocks: [
        { p: "{brand} is a set of AI assistants for small and medium businesses. Today it helps a wholesale business keep its leads, enquiries, quotes, orders, store visits and saree catalogue in one place, and an assistant called Agent OWL reads those records to answer questions and to prepare drafts. It is offered to try for free while we build it [CONFIRM: pricing has not been decided; a change to fees will be told to you before it applies]. Features may change, and some are marked as not yet available." },
      ],
    },
    {
      id: "account",
      title: "2. Your account",
      blocks: [
        {
          ul: [
            "You must be at least 18, give true details, and keep your password and your authenticator app to yourself. Owners and Admins must use a second factor.",
            "You are responsible for what is done with your account and for the people you add to your business and the role you give them.",
            "Tell us at once at [EMAIL] if you think someone else has got into your account.",
          ],
        },
      ],
    },
    {
      id: "yourdata",
      title: "3. Your data and your customers",
      blocks: [
        { p: "Your business's records stay yours. You give us the right to store and process them only to run {brand} for you, as the Privacy Policy describes." },
        { p: "You are responsible for having the right to hold and use the details of the people you enter, and for contacting them lawfully. That includes getting their consent where the law needs it (for example for WhatsApp, e-mail and calls), recording it, honouring do-not-contact requests, and following the rules of WhatsApp and of the telecom regulator. {brand} records consent and do-not-contact choices and will not draft to someone who has said stop, but it does not decide for you whether you may contact someone." },
        { p: "Do not enter other people's data that you have no reason to hold. Do not put in anything unlawful." },
      ],
    },
    {
      id: "ai",
      title: "4. The AI assistant",
      blocks: [
        {
          ul: [
            "Agent OWL is an AI. It can be wrong, incomplete or out of date. Read what it prepares before you rely on it.",
            "Messages it writes to your customers may be written by AI, and are labelled as coming from the business's AI assistant. You must not remove or hide that label.",
            "It does not set or change prices: prices come from your price list by fixed rules. It does not take a payment or make a financial commitment for you.",
            "A message to a customer goes out only under the rules you have switched on. Anything about money, a promise or a complaint waits for a person to approve it. You are responsible for what your business sends, including what you approve and what you allow to go automatically.",
            "Do not use the assistant to deceive, harass or spam anyone, or to break the law.",
          ],
        },
      ],
    },
    {
      id: "use",
      title: "5. Acceptable use",
      blocks: [
        { p: "Do not try to get into another business's records, probe or overload the service, copy it, reverse-engineer it, or use it to send unlawful, abusive or misleading messages. We may limit or suspend an account that does, or that puts others or the service at risk." },
      ],
    },
    {
      id: "third",
      title: "6. Other services",
      blocks: [
        { p: "{brand} relies on other companies for hosting, sign-in, AI models, speech and, if you connect it, WhatsApp (see the Privacy Policy). Their own terms apply to their part. We are not responsible for an outage or change on their side, though we will try to limit its effect on you." },
      ],
    },
    {
      id: "ip",
      title: "7. Ownership",
      blocks: [{ p: "{brand}, its software, design and name belong to us or our licensors. You get a personal, non-transferable right to use it while these terms apply. You keep ownership of your data and of the photos and text you add." }],
    },
    {
      id: "avail",
      title: "8. No promises about availability",
      blocks: [{ p: "{brand} is early software. We do our best to keep it running and your data safe, but it may be unavailable, change, or contain mistakes. Keep your own copy of anything you cannot afford to lose; you can export your leads." }],
    },
    {
      id: "liability",
      title: "9. Limits of our responsibility",
      blocks: [
        { p: "[LEGAL REVIEW: this section needs a lawyer.] To the extent the law allows, we are not liable for indirect or consequential loss, lost profit or lost business, or for a decision you make on the basis of something the AI prepared. Our total liability for any claim is limited to [CONFIRM: amount, for example what you paid us in the last 12 months]. Nothing in these terms limits a liability that cannot be limited by law, or your rights under data protection law." },
      ],
    },
    {
      id: "end",
      title: "10. Ending the agreement",
      blocks: [
        { p: "You can stop using {brand} at any time and ask us to delete your account and data (Privacy Policy, section 9). We may suspend or end your access if you break these terms or the law, or if we stop offering the service, and where we can we will tell you first and give you time to export your records." },
      ],
    },
    {
      id: "changes",
      title: "11. Changes",
      blocks: [{ p: "When we change these terms, the new text gets a new version and date. For a material change we will tell you before it applies and ask you to accept it again. The version you accepted at sign-up is recorded with the time." }],
    },
    {
      id: "law",
      title: "12. Law and disputes",
      blocks: [{ p: "These terms are governed by the laws of India. The courts at [CONFIRM: CITY] have jurisdiction, [LEGAL REVIEW: and whether to provide for arbitration]. If you are a consumer in the EU or UK, you also keep the protection of the mandatory laws of your country." }],
    },
    {
      id: "contact",
      title: "13. Contact",
      blocks: [{ p: "[COMPANY NAME], [ADDRESS], [EMAIL]. Grievance officer: [GRIEVANCE OFFICER] (see the Privacy Policy, section 10)." }],
    },
  ],
};
