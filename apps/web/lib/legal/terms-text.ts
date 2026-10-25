import type { LegalText } from "./types";

/**
 * The Terms of Use (jobs BH, DB). Plain English for a shop owner. It describes the service as built: an AI assistant that reads a business's records and prepares drafts, with a person approving anything risky.
 * Names and e-mail addresses are {tokens} filled from lib/site/business.ts. Whether a lawyer has read it is NOT said on the page (the report of job DB lists it as pending; LEGAL_IS_DRAFT in version.ts is the banner switch).
 * English only: the legal text is not machine-translated; the page opens with a short summary in the visitor's language.
 */
export const TERMS: LegalText = {
  title: "Terms of Use",
  intro: [
    "These terms are the agreement between you and Stack19, {business_description} (\"we\", \"us\"), for using {brand}. By ticking the box when you sign up, you agree to them and to the Privacy Policy. If you use {brand} for a business, you confirm that you may agree on its behalf.",
  ],
  sections: [
    {
      id: "service",
      title: "1. What {brand} is",
      blocks: [
        { p: "{brand} is a set of AI assistants for small and medium businesses. Today it helps a wholesale business keep its leads, enquiries, quotes, orders, store visits and catalogue in one place, helps a builders' merchant with sites, deliveries and what customers owe, and helps a school with admissions and fees. An AI assistant reads those records to answer questions and to prepare drafts. Features may change, and some are marked as not yet available." },
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
            "Tell us at once at {support} if you think someone else has got into your account.",
          ],
        },
      ],
    },
    {
      id: "trial",
      title: "3. Free trial, payment and cancelling",
      blocks: [
        {
          ul: [
            "You start with a {trial_days}-day free trial, counted from the day your WhatsApp is connected. To start it you add a payment method.",
            "If you cancel before the trial ends, nothing is charged.",
            "Our prices are not published yet. Before we charge you anything we will show you the plan and the price, and you must agree to it. If you do not agree, the trial ends and nothing is charged.",
            "To cancel, write to {billing} from the e-mail address of your account, or use the cancel option in the app where it is offered. We confirm the cancellation by e-mail.",
            "When a paid plan starts, we send an invoice with the GST charged, to the billing e-mail you give. Questions about a payment or an invoice: {billing}.",
          ],
        },
      ],
    },
    {
      id: "yourdata",
      title: "4. Your data and your customers",
      blocks: [
        { p: "Your business's records stay yours. You give us the right to store and process them only to run {brand} for you, as the Privacy Policy describes." },
        { p: "You are responsible for having the right to hold and use the details of the people you enter, and for contacting them lawfully. That includes getting their consent where the law needs it (for example for WhatsApp, e-mail and calls), recording it, honouring do-not-contact requests, and following the rules of WhatsApp and of the telecom regulator. {brand} records consent and do-not-contact choices and will not draft to someone who has said stop, but it does not decide for you whether you may contact someone." },
        { p: "Do not enter other people's data that you have no reason to hold. Do not put in anything unlawful. If you run a school, you are responsible for the consent of the parents or guardians of your students." },
      ],
    },
    {
      id: "ai",
      title: "5. The AI assistant, and your approval",
      blocks: [
        {
          ul: [
            "The assistant is an AI. It can be wrong, incomplete or out of date. Read what it prepares before you rely on it.",
            "Messages it writes to your customers may be written by AI, and are labelled as coming from the business's AI assistant. You must not remove or hide that label.",
            "It does not set or change prices: prices come from your price list by fixed rules. It does not take a payment or make a financial commitment for you.",
            "Nothing is sent to your customers as a campaign (a batch of reminders or notices) until you, the Owner, have approved it. Anything about money, a promise or a complaint also waits for a person to approve it. You are responsible for what your business sends, including what you approve and what you allow to go automatically under the rules you switched on.",
            "Do not use the assistant to deceive, harass or spam anyone, or to break the law.",
          ],
        },
      ],
    },
    {
      id: "use",
      title: "6. Acceptable use",
      blocks: [
        {
          ul: [
            "No spam. Do not send unsolicited or bulk messages, buy or scrape lists of people, or contact someone who has said stop.",
            "Consent for messages and calls. Message or call a person only if you have their consent where the law requires it (including WhatsApp, SMS, e-mail and phone calls), keep a record of it, and respect the Do Not Disturb register and quiet hours.",
            "Do not send unlawful, abusive, hateful or misleading messages.",
            "Do not try to get into another business's records, probe or overload the service, copy it, or reverse-engineer it.",
          ],
        },
        { p: "We may limit or suspend an account that breaks these rules, or that puts others or the service at risk." },
      ],
    },
    {
      id: "third",
      title: "7. Other services",
      blocks: [
        { p: "{brand} relies on other companies for hosting, sign-in, AI models, speech, payments and, if you connect it, WhatsApp (see the Privacy Policy). Their own terms apply to their part. We are not responsible for an outage or change on their side, though we will try to limit its effect on you." },
      ],
    },
    {
      id: "ip",
      title: "8. Ownership",
      blocks: [{ p: "{brand}, its software, design and name belong to us or our licensors. You get a personal, non-transferable right to use it while these terms apply. You keep ownership of your data and of the photos and text you add." }],
    },
    {
      id: "avail",
      title: "9. No promises about availability",
      blocks: [{ p: "{brand} is early software. We do our best to keep it running and your data safe, but it may be unavailable, change, or contain mistakes. Keep your own copy of anything you cannot afford to lose; you can export your leads." }],
    },
    {
      id: "liability",
      title: "10. Limits of our responsibility",
      blocks: [
        { p: "To the extent the law allows, we are not liable for indirect or consequential loss, lost profit or lost business, or for a decision you make on the basis of something the AI prepared. Our total liability for any claim is limited to the amount you paid us for the service in the 12 months before the claim. Nothing in these terms limits a liability that cannot be limited by law, or your rights under data protection law." },
      ],
    },
    {
      id: "end",
      title: "11. Ending the agreement",
      blocks: [
        { p: "You can stop using {brand} at any time and ask us to delete your account and data (Privacy Policy, section 11, and the page /data-deletion). We may suspend or end your access if you break these terms or the law, or if we stop offering the service, and where we can we will tell you first and give you time to export your records." },
      ],
    },
    {
      id: "changes",
      title: "12. Changes",
      blocks: [{ p: "When we change these terms, the new text gets a new version and date. For a material change we will tell you before it applies and ask you to accept it again. The version you accepted at sign-up is recorded with the time." }],
    },
    {
      id: "law",
      title: "13. Law and disputes",
      blocks: [{ p: "These terms are governed by the laws of India, and disputes about them are for the competent courts in India. If you are a consumer in the EU or UK, you also keep the protection of the mandatory laws of your country." }],
    },
    {
      id: "contact",
      title: "14. Contact",
      blocks: [
        {
          ul: [
            "General questions: {hello}",
            "Help with the app: {support}",
            "Payments and invoices: {billing}",
            "Privacy and grievances: {privacy_email} (Grievance Officer: {proprietor}, see the Privacy Policy, section 12)",
          ],
        },
      ],
    },
  ],
};
