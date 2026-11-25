import type { LegalText } from "./types";

/**
 * The Acceptable Use Policy: a DRAFT written by C2 on 29 Nov 2026 for the owner to approve ("legal and privacy texts stay drafts until I approve"). Five plain rules for anyone who uses {brand} to call or message people; they are the same five as the panel "Before you
 * start calling" in the app. The page carries the "Draft, pending legal review" banner, is never indexed and exists only where LEGAL_DRAFT_PAGES is on (lib/legal/version.ts DRAFT_DOC_IDS). Nothing here promises a legal outcome: the lawyer's review comes before it goes live.
 */
export const AUP: LegalText = {
  title: "Acceptable Use Policy",
  intro: ["This policy says what you may and may not do when you use {brand} to call or message people. It is part of the Terms of Use. {business_description} (\"we\", \"us\") provides the service. You are the business that calls or messages, and you are responsible for it."],
  sections: [
    {
      id: "rules",
      title: "1. The five rules",
      blocks: [
        {
          ul: [
            "Contact only people who agreed. That means people who wrote to you about your business (their enquiry is in writing), or whose consent is recorded. Never use lists that were bought, scraped or collected without their agreement.",
            "Keep proof. Be able to show where each person's details came from and when they agreed. We may ask you to show it.",
            "Respect stop requests. When someone asks you to stop, they are never contacted again. We add them to your do-not-call list for you, and you must not remove them.",
            "Say who you are. Your business is the caller. The assistant says that it is an assistant and never pretends to be a person.",
            "Follow the law. Calling hours, the national do-not-disturb list and phone company rules apply. You are responsible for who you call and what is said.",
          ],
        },
      ],
    },
    {
      id: "hours",
      title: "2. Calling hours",
      blocks: [{ p: "Calls go out between 10 am and 9 pm India time. We fix these hours and you cannot change them. A call outside the hours waits until they open again." }],
    },
    {
      id: "not",
      title: "3. What is not allowed",
      blocks: [
        {
          ul: [
            "Calls or messages that threaten, harass or mislead anyone.",
            "Selling or asking for anything illegal, or pretending to be a bank, a government office or another business.",
            "Asking for passwords, one-time codes, card numbers or other secrets on a call.",
            "Using the service to send the same message to people who did not agree to it.",
          ],
        },
      ],
    },
    {
      id: "breach",
      title: "4. If these rules are broken",
      blocks: [{ p: "We may pause your calling, switch off a job, or close the account. We tell you why. Penalties or claims that arise from your calls are yours, as the business that makes them." }],
    },
    {
      id: "duties",
      title: "5. Your duties as the business that calls (draft)",
      blocks: [
        { p: "Draft for the owner to review, and for our advocate to review before it is final. It may change." },
        {
          ul: [
            "Keep the records. For every person you contact, keep where and when they enquired in writing or gave consent. We may ask you to show them, and we may stop automatic calls to anyone you cannot show them for.",
            "A written enquiry (a form, a WhatsApp message, an e-mail) lets you follow up for a short time only: 7 days. After that you need the person's consent on record. A spoken enquiry at the counter does not count.",
            "Penalties, blocks and claims from the phone company or the telecom regulator that come from your calls, for example after complaints, are yours, as the business that makes them. They are not ours.",
            "We may pause or stop calling on your account at any time, for example after complaints or when proof of consent is missing. We tell you why.",
          ],
        },
      ],
    },
    { id: "contact", title: "6. Questions", blocks: [{ p: "Write to {support} if you are not sure whether something is allowed. We answer within 2 working days." }] },
  ],
};
