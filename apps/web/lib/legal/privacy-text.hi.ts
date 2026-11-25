import type { LegalText } from "./types";

/**
 * The same English text as privacy-text.ts (owner decision 18 Nov 2026: no translation of legal text until the owner approves one). This file keeps the page's structure the same in every language; when a hi reading is approved it replaces the text below.
 */
export const PRIVACY_HI: LegalText = {
  title: "Privacy notice",
  intro: [
    "This notice says in plain words what {brand} keeps about people, why, who helps us handle it, where it is stored, how long we keep it, and how you can have it deleted or stop messages.",
    "{brand} is provided by Stack19, {business_description} (\"we\", \"us\"). Write to {privacy_email} for anything in this notice, and to {security_email} to report a security problem.",
  ],
  sections: [
    {
      id: "collect",
      title: "1. What we collect, and why",
      blocks: [
        {
          table: {
            head: ["What", "Examples", "Why"],
            rows: [
              ["Your account", "Your name, e-mail address, password (kept only as a one-way hash), your role in a business, language and light or dark choice.", "To let you sign in and use the service."],
              ["Your business", "The business name, team members, type of business, opening times, quiet hours and sending settings.", "To run the service for the business."],
              ["Your customers", "Names, phone numbers, e-mail addresses, what they asked for; whether each person agreed to be contacted, and who said STOP.", "So the business can answer and follow up people who asked to hear from it. We handle this only for the business."],
              ["Messages and chats", "Messages drafted for or sent to customers, their status and history, who approved them; your chats with our AI assistant.", "To prepare, send and track messages; to answer you."],
              ["Calls", "If the business uses our AI assistant to call people who enquired: the words of the call written out as text, with its time, length, language and outcome. Calls are not recorded.", "So the business can read what was said."],
              ["Phone number documents", "Documents needed to register your business phone number are given by you to our telephony provider (VoiceLink); Stack19 does not keep them. We keep only the application status.", "To register a business phone number for you."],
              ["Website visitors", "If you join the waitlist: your name, kind of business, city, phone number or e-mail, language, and whether you ticked the box for news. If you write to us: what you send.", "To reply and to keep the list you asked to join."],
              ["Records of use", "A security log of who did what in a workspace and when; counts of AI use; short-lived records of sign-in attempts.", "To keep the service safe and working."],
            ],
          },
        },
        { p: "We do not collect your contacts or address book, your precise location, or advertising or tracking data. We use no advertising and no analytics. Our cookies only keep you signed in and remember your language and theme." },
        { p: "When you press Connect with Facebook, Meta's sign-up window opens and Meta handles that step under its own terms; we load nothing from Meta before that." },
      ],
    },
    {
      id: "ai",
      title: "2. Our assistant is an AI",
      blocks: [
        { p: "The assistant in {brand} is an AI. Every call it makes starts by saying so. The first chat message it writes to a customer says it comes from the business's AI assistant; later messages in that chat do not repeat it, and messages the business writes itself, and WhatsApp templates (the business's own approved words), do not carry it. It follows the business's own rules: it does not contact anyone who did not ask to hear from the business, and it stops at once when someone says STOP." },
      ],
    },
    {
      id: "share",
      title: "3. Who helps us handle it",
      blocks: [
        { p: "These companies handle personal data for us, only to run the service. We do not sell personal data. The list below is read from our service when you open this page, so it is always the list in use:" },
        { p: "Some of them (AI and speech) may handle a request outside India while it is being answered; the list says where each one is." },
      ],
    },
    {
      id: "where",
      title: "4. Where it is stored",
      blocks: [
        { p: "Your data is stored in India: the database, sign-in and files at Supabase in Mumbai, and the app servers at Google Cloud in Mumbai. Some of the companies in section 3 (AI and speech) may handle a request outside India while it is being answered; the list says which." },
      ],
    },
    {
      id: "keep",
      title: "5. How long we keep it",
      blocks: [
        {
          ul: [
            "Your business's records, chats and call text: while the business uses {brand}. When the workspace is deleted, they are deleted with it.",
            "Calls are not recorded, so there is no recording to keep.",
            "The security log: {log_days} days. Waitlist sign-ups and complaints: 12 months.",
            "Phone number documents: not stored by us (section 1). We keep only the registration number, its status and the type of document.",
            "Business details from Google Maps in the Lead Finder: not more than a month.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "6. Seeing, correcting and deleting data, and stopping messages",
      blocks: [
        {
          ul: [
            "To see, correct or delete data: a business can export and erase its own records in the app (Settings, then Privacy and data). To delete your account, see the page {domain}/data-deletion. A person whose details a business holds can ask the business, or write to us at {privacy_email}. We answer within {request_days} days.",
            "To stop messages or calls: say STOP in a message or on a call and it works at once and for good. If you ask by e-mail to {privacy_email}, we act on it within {withdrawal_hours} hours. A business can also mark a person as do-not-contact in the app.",
            "Consent is only what the person gave: the tick box on a form, or a yes the business recorded and how it was given. Nothing is assumed from a list. A person can withdraw it at any time, as in the line above.",
            "Complaints: write to {proprietor} at {privacy_email}. We answer within {grievance_days} days.",
          ],
        },
      ],
    },
    {
      id: "never",
      title: "7. What we never do",
      blocks: [
        { ul: ["Sell personal data.", "Call or message people who did not ask to be contacted.", "Call businesses found by the Lead Finder: you contact them yourself.", "Record calls."] },
        { p: "No service can promise perfect security. We keep data encrypted, limit who can see it, and tell the people affected if something goes wrong." },
      ],
    },
    {
      id: "contact",
      title: "8. Changes and contact",
      blocks: [
        { p: "If this notice changes in a way that matters, we tell signed-in users before it applies. Questions: {privacy_email}." },
      ],
    },
  ],
};
