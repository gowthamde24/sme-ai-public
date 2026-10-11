import type { LegalText } from "./types";

/**
 * The Privacy Policy (job BH), written from the data inventory of docs/data-inventory.md (what the code and the database really hold). Plain English for a shop owner; structured for India's Digital
 * Personal Data Protection Act, 2023 (notice, purposes, consent, rights, grievance, withdrawal) with the basics for visitors from the EU and UK. DRAFT, pending legal review (lib/legal/version.ts).
 * [CAPITALISED BRACKETS] are for the owner to fill; `[CONFIRM: ...]` marks a fact only the owner or a provider's contract can settle.
 */
export const PRIVACY: LegalText = {
  title: "Privacy Policy",
  intro: [
    "This policy explains what personal data {brand} keeps, why, who else handles it, how long we keep it, and how you can use your rights. It is written for the owners and staff of Indian shops and small businesses who use the service, and for the customers of those businesses.",
    "{brand} is provided by [COMPANY NAME], [ADDRESS] (\"we\", \"us\"). Contact: [EMAIL].",
  ],
  sections: [
    {
      id: "roles",
      title: "1. Two roles: who decides what",
      blocks: [
        { p: "There are two kinds of personal data in {brand}, and we have a different role for each." },
        {
          ul: [
            "Your account data (you and your team: name, e-mail, sign-in details). We decide why and how this is used. For this data we are the data fiduciary under India's DPDP Act 2023 (the \"controller\" under the GDPR).",
            "Your customers' data (the people and companies you enter as leads, contacts and customers). Your business decides why it keeps them and what it does with them. We only handle this data for your business, on its instructions, to run the service (we are its \"data processor\"). Your business is the data fiduciary for it, and is responsible for having the right to contact its customers.",
          ],
        },
      ],
    },
    {
      id: "collect",
      title: "2. What we collect",
      blocks: [
        {
          table: {
            head: ["What", "Examples", "Whose it is"],
            rows: [
              ["Account", "Your name, e-mail address, password (kept only as a one-way hash by our sign-in provider; nobody can read it), the secret of your authenticator app (second factor), your role in a business (Owner, Admin, Sales, Viewer), language and light/dark choice, the version of these terms you accepted and when.", "You and your team"],
              ["Business", "The business name, its team members and roles, plan, opening times, quiet hours, sending settings.", "Your business"],
              ["Your customers", "Name, phone number, e-mail address, job title; company name, website, city and region; whether each person agreed to be contacted by e-mail, WhatsApp or phone, and do-not-contact marks; where a lead came from and notes about it; the text of enquiries (up to 6,000 characters, with a subject); delivery city; quotes, orders and amounts; store visits (date, time, number of people, purpose, notes); call requests; sarees you list (names, prices, photos you upload).", "Your customers, entered by your team or taken from an enquiry"],
              ["Messages", "Messages drafted for or sent to your customers, their English meaning, their status and history, who approved them; your chats with Agent OWL (what you ask and what it answers).", "Your business and your customers"],
              ["Your voice", "If you use the microphone, the recording is sent to a speech service to be turned into text (see section 5). We do not keep the recording; the text becomes a chat message.", "You"],
              ["Records of use", "A security log of who did what in a workspace and when (sensitive values are logged by name only, not by content); a count of AI use and its cost (not its content); a short-lived record of sign-up attempts, to stop abuse; and, kept by our sign-in provider for each session, the time, your IP address and your browser type.", "You and your team"],
              ["On your device", "Cookies (section 11) and a few settings kept in your browser's own storage, such as whether the menu is collapsed. They stay on your device.", "You"],
            ],
          },
        },
        { p: "We do not collect payment card numbers (the product takes no payments today), your contacts or address book, your precise location, or anything about children on purpose. We use no advertising and no analytics." },
      ],
    },
    {
      id: "why",
      title: "3. Why we use it, and on what basis",
      blocks: [
        {
          ul: [
            "To run the service for you: to let you sign in, keep your business's records, prepare quotes, drafts and orders, and show you what needs your attention.",
            "To keep it safe: to check who you are (including a second factor for Owners and Admins), keep each business's records apart from every other business, prevent abuse, and keep a log of actions.",
            "To respect your customers' choices: to remember who said no, and never draft or send to them. This is why a keyed fingerprint of an erased person's phone number or e-mail address is kept after erasure (section 8).",
            "To meet our legal duties and to answer your requests under this policy.",
          ],
        },
        { p: "Under the DPDP Act we rely on your consent, which you give by ticking the box when you sign up (you can withdraw it, section 9), and on the uses the Act allows without consent, such as providing a service you asked for and meeting legal duties. For visitors in the EU or UK the legal bases are: performing our contract with you, our legitimate interest in running a safe service, our legal obligations, and your consent where we ask for it." },
        { p: "We use your data for these purposes only. We do not sell it and we do not use it for advertising." },
      ],
    },
    {
      id: "ai",
      title: "4. Agent OWL is an AI assistant",
      blocks: [
        { p: "Agent OWL, the assistant in {brand}, is an AI. It reads your business's records to answer your questions and to prepare drafts: replies, follow-ups, quotes and visit bookings. Messages it writes to your customers may be written by AI, and they are labelled as coming from the business's AI assistant." },
        { p: "The AI does not set or change prices (prices come from your price list by fixed rules). A message to a customer goes out only under the rules your business has switched on: money, promises and complaints always wait for a person's approval, and a customer who has said stop is never contacted. A person stays responsible for what is sent." },
        { p: "To do this, your question and the records it needs (for example company names, message text and amounts) are sent to an AI model provider ([MODEL PROVIDER(S)]) and processed there. The service is designed not to pass customer contact details (names, phone numbers, e-mail addresses) to the model, but free text such as enquiry messages and company names can contain personal data. [CONFIRM: the provider's region, whether it keeps prompts, and that it does not train on them.]" },
      ],
    },
    {
      id: "voice",
      title: "5. Voice",
      blocks: [
        { p: "The microphone is optional; you can always type. If you use it, your voice is sent to our speech service, [SPEECH PROVIDER], to be understood, and, if you chose spoken answers, the written answer is sent to it to be read aloud. We do not keep the recording. The words it was understood as are saved like any question you type. [CONFIRM: the provider's retention terms; zero retention is the setting we use.]" },
      ],
    },
    {
      id: "share",
      title: "6. Who else handles your data",
      blocks: [
        { p: "We do not sell personal data. These companies handle it for us, only to provide the service:" },
        {
          table: {
            head: ["Who", "What for", "Where"],
            rows: [
              ["Supabase", "Database, sign-in, file storage (the photos you upload)", "[CONFIRM: Mumbai, India (ap-south-1)]"],
              ["[HOSTING PROVIDER]", "Runs the website and the service", "[CONFIRM: Mumbai, India]"],
              ["[MODEL PROVIDER(S)]", "AI answers and drafts (section 4)", "[CONFIRM]"],
              ["[SPEECH PROVIDER]", "Turns your voice into text and text into speech (section 5), only if you use voice", "[CONFIRM]"],
              ["[E-MAIL PROVIDER]", "Sends the sign-up confirmation and security e-mails", "[CONFIRM]"],
              ["Meta (WhatsApp)", "Only when a business connects its own WhatsApp number: the message text and the recipient's phone number go through WhatsApp to the customer. Nothing is sent to WhatsApp before a business does this.", "As Meta describes"],
            ],
          },
        },
        { p: "We may also disclose data if the law or a court requires it. If we are ever sold or merged, the data goes with the service on the same terms, and we will tell you first." },
      ],
    },
    {
      id: "where",
      title: "7. Where it is kept, and transfers abroad",
      blocks: [
        { p: "We aim to keep the database and the service in India [CONFIRM: before launch]. If a provider listed above handles data outside India, that is a transfer abroad. The DPDP Act allows this except to countries the Government of India restricts. For visitors in the EU or UK, we will use the safeguards the GDPR requires for a transfer [CONFIRM: for example standard contractual clauses]." },
      ],
    },
    {
      id: "keep",
      title: "8. How long we keep it",
      blocks: [
        {
          table: {
            head: ["Data", "How long"],
            rows: [
              ["Account data", "While your account exists, and until we have finished deleting it after you ask."],
              ["A business's records (customers, enquiries, quotes, orders, messages, visits, catalogue)", "Until the Owner erases them (see section 9). There is no automatic deletion today [CONFIRM: a retention schedule before launch]."],
              ["Chats with Agent OWL", "Until erased, as above."],
              ["Voice recordings", "Not kept."],
              ["Security log and usage counts", "Kept as a record of what happened. It holds no contact details or message text; the erasure of a company also removes that company's identity from it."],
              ["Do-not-contact keys", "When a customer is erased, a keyed fingerprint (not readable) of their phone number or e-mail address is kept so they are not contacted again. This is arguably personal data, kept on purpose to honour their choice."],
              ["Backups", "Copies in backups age out after about 7 days [CONFIRM]. If we restore a backup, we repeat any erasures made since."],
              ["Exports you downloaded", "These are files on your side. We cannot erase them; the erasure result tells the Owner how many were made."],
            ],
          },
        },
      ],
    },
    {
      id: "rights",
      title: "9. Your rights, and how to use them",
      blocks: [
        { p: "You have the right to:" },
        {
          ul: [
            "get a summary of your personal data and how it is processed, and who it is shared with (access);",
            "have wrong or incomplete data corrected, and out-of-date data updated (correction);",
            "have your data erased (erasure);",
            "withdraw your consent at any time, as easily as you gave it; this does not undo what was done before, and some features then stop working;",
            "get a reply to a complaint (grievance redress), see section 10;",
            "name another person to exercise your rights if you die or cannot act (nomination);",
            "for visitors in the EU or UK: receive your data in a common format (in {brand}, a business can export its leads as CSV or JSON), ask us to restrict or stop certain uses, and complain to your data protection authority.",
          ],
        },
        { p: "How. If you are an Owner, you can erase one customer, one company or a whole workspace yourself in Settings, Privacy (Owners only, with a typed confirmation; a whole-workspace erasure has a 24-hour window in which an Owner or Admin can cancel it). For anything else, including deleting your account, write to [EMAIL]; we will answer within [30] days [CONFIRM]. If you are a customer of a business that uses {brand}, please contact that business first; it decides about your data and we will help it to act. We may need to check who you are before we act." },
        { p: "Limits you should know. Erasure is complete for structured data and for exact identifiers (a phone number or e-mail address, wherever it appears in the workspace's text). A name inside free text, such as a note that merely mentions a person, cannot be found with certainty; those places are listed for the Owner to review by hand. We cannot erase an export that was already downloaded, and backups age out as described in section 8." },
      ],
    },
    {
      id: "grievance",
      title: "10. Grievance officer",
      blocks: [
        { p: "If you have a complaint about how your personal data is handled, write to our grievance officer: [GRIEVANCE OFFICER], [COMPANY NAME], [ADDRESS], [EMAIL]. We will acknowledge it and answer within [CONFIRM: number] days. If you are not satisfied, you may complain to the Data Protection Board of India once it is in operation, or, in the EU or UK, to your data protection authority." },
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies and similar storage",
      blocks: [
        { p: "We set only strictly necessary cookies: to keep you signed in and secure, and to remember your language, your light or dark choice, and your cookie choice. We set no advertising, tracking or analytics cookies and load no analytics. The cookie settings link at the bottom of every page shows the exact list and has an Analytics switch, which is off and will stay off unless we ever add analytics and you switch it on." },
        { p: "The list is: the sign-in cookie of our sign-in provider (sb-<project>-auth-token, up to 400 days or until you sign out), sme_lang (language, one year), sme_theme (light or dark, one year) and sme_consent (your cookie choice, one year). A few settings, such as whether the side menu is collapsed or spoken answers play automatically, are kept in your browser's own storage and never sent to us." },
      ],
    },
    {
      id: "security",
      title: "12. Security",
      blocks: [
        { p: "Each business's records are kept apart from every other business's by rules in the database itself. Owners and Admins must use a second factor. Access is limited to what each role needs, and a log records actions. No service can promise perfect security. If a breach of personal data happens, we will tell the people and the authorities affected as the law requires." },
      ],
    },
    {
      id: "children",
      title: "13. Children",
      blocks: [{ p: "{brand} is for businesses and is not meant for anyone under 18. We do not knowingly collect a child's data. If you think we have, write to [EMAIL] and we will erase it." }],
    },
    {
      id: "changes",
      title: "14. Changes to this policy",
      blocks: [{ p: "When we change this policy we will give the new text a new version and date and, for a material change, tell you before it applies and ask you to accept it again. The version you accepted at sign-up is recorded with the time." }],
    },
  ],
};
