import type { LegalText } from "./types";

/**
 * The Terms of Use for FREE EARLY ACCESS, plain and about one page (owner decision 18 Nov 2026: no lawyer before the first pilots; a lawyer's short review is planned before paid plans). Written from C1's plain draft
 * (~/Desktop/stack19-jobs/drafts/free-early-access-terms-DRAFT.md). DRAFT: the owner reads and approves it. Names and e-mail addresses are {tokens} filled from lib/site/business.ts. English only: legal text is not machine-translated;
 * the page opens with a short summary in the visitor's language.
 */
export const TERMS: LegalText = {
  title: "Terms of Use",
  intro: [
    "These are the terms for using {brand} during Free Early Access, between you (the business that signs up) and Stack19, {business_description} (\"we\", \"us\"). By ticking the box when you sign up, you agree to them.",
  ],
  sections: [
    {
      id: "what",
      title: "1. What this is",
      blocks: [
        { p: "During Free Early Access you use the whole product for free. We do not ask for a card. If we ever start charging, we tell you first and you decide; your data stays yours either way. The assistant is an AI: it reads your business's records to answer questions and to prepare drafts, and it works within your rules." },
      ],
    },
    {
      id: "monthly",
      title: "2. What you get each month (India time)",
      blocks: [
        {
          ul: [
            "60 minutes of AI calls.",
            "300 WhatsApp messages that your business starts (replies inside WhatsApp's 24 hours, quotes and orders are not counted).",
            "One business phone number, once we have it ready for you.",
            "AI help for your day, within a fair daily limit.",
            "One search for new customers (Lead Finder) a month. You contact the businesses it finds yourself; the assistant never calls or messages them.",
          ],
        },
        { p: "When one runs out, that one stops until next month (or until we add more). Everything else keeps working. You can see how much you have used. We may change these numbers; we tell you before we do." },
      ],
    },
    {
      id: "who",
      title: "3. Who you may call and message",
      blocks: [
        { p: "Only people who asked to hear from you: they filled your form or ad, wrote or called you, or are your customers who agreed. No cold calls, no bought or scraped lists, no Lead Finder prospects, no promotions to people who never said yes. {brand} refuses a call without a recorded request from that person (at most 30 days old), and it never contacts someone who said STOP. You are still responsible for having their permission. Every call starts by saying it is an AI assistant, and calls are not recorded. The first chat message the assistant writes to a customer says it is an AI assistant; messages you write yourself, and WhatsApp templates, are your own words." },
      ],
    },
    {
      id: "data",
      title: "4. Your data",
      blocks: [
        {
          ul: [
            "It is yours. We use it only to run {brand} for you. We do not sell it.",
            "Our service providers handle it only for us. The list is in the Privacy notice.",
            "It is kept in India (Mumbai). A few providers (speech and AI) may handle a request outside India: the Privacy notice says which.",
            "You can download your data at any time and ask us to delete it. We delete your workspace within 30 days of your request (draft: the owner confirms the number), except what the law makes us keep.",
            "Phone-number registration documents (GST or Udyam) are given by you to VoiceLink, the phone provider. Stack19 does not keep the file. We only keep the registration number, its status and the type of document.",
          ],
        },
      ],
    },
    {
      id: "promise",
      title: "5. What we promise, and what we do not",
      blocks: [
        { p: "We aim for it to work well, but this is early access: no promise that it is always up, that a call connects, or that a lead buys. Calls and WhatsApp depend on the phone and WhatsApp companies. We answer support at {support} on working days." },
      ],
    },
    {
      id: "stopping",
      title: "6. Stopping",
      blocks: [
        { p: "You can leave any time. We can end Free Early Access with 30 days' notice (draft: the owner confirms the number), and we keep your data available to download during that time. We can pause a business that breaks these terms or puts others at risk, and we say why." },
      ],
    },
    {
      id: "questions",
      title: "7. Questions",
      blocks: [
        { p: "Write to {hello}. Indian law applies. Complaints about data go to {proprietor} at {privacy_email}." },
      ],
    },
  ],
};
