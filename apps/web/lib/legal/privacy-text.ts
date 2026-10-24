import type { LegalText } from "./types";

/**
 * The Privacy Policy (jobs BH, DB), written from the data inventory of docs/data-inventory.md (what the code and the database really hold). Plain English for a shop owner or a school office; structured for India's
 * Digital Personal Data Protection Act, 2023 (notice, purposes, consent, rights, grievance, withdrawal, children) with the basics for visitors from the EU and UK.
 * Names, e-mail addresses and the number of days are {tokens} filled from lib/site/business.ts (the one place they are written). Telugu, Hindi and Kannada versions: privacy-text.te.ts, .hi.ts, .kn.ts (same section ids).
 * Whether a lawyer has read it is NOT said on the page; the report of job DB lists it as pending, and LEGAL_IS_DRAFT (version.ts) is the switch for the page banner.
 */
export const PRIVACY: LegalText = {
  title: "Privacy Policy",
  intro: [
    "This policy explains what personal data {brand} keeps, why, where it is stored, who else handles it, how long we keep it, and how you can use your rights. It is written for the owners and staff of Indian shops, builders' merchants and schools who use the service, and for the customers and parents those businesses write to.",
    "{brand} is provided by Stack19, {business_description} (\"we\", \"us\"). Contact for anything in this policy: {privacy_email}.",
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
            "Your customers' data (the people and companies you enter as leads, contacts, customers, parents and guardians). Your business decides why it keeps them and what it does with them. We only handle this data for your business, on its instructions, to run the service (we are its \"data processor\"). Your business is the data fiduciary for it, and is responsible for having the right to contact its customers.",
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
              ["Account", "Your name, e-mail address, password (kept only as a one-way hash by our sign-in provider; nobody can read it), the secret of your authenticator app (second factor), your role in a business (Owner, Admin, Sales, Viewer), language and light/dark choice, the version of these terms you accepted and when. If you sign in with Google or Facebook, the name and verified e-mail address that account shares with us.", "You and your team"],
              ["Business", "The business name, its team members and roles, the type of business, plan, opening times, quiet hours, sending settings.", "Your business"],
              ["Your customers", "Name, phone number, e-mail address, job title; company name, website, city and region; whether each person agreed to be contacted by e-mail, WhatsApp or phone, and do-not-contact marks; where a lead came from and notes about it; the text of enquiries (up to 6,000 characters, with a subject); delivery city; quotes, orders and amounts; store visits (date, time, number of people, purpose, notes); call requests.", "Your customers, entered by your team or taken from an enquiry"],
              ["Messages", "Messages drafted for or sent to your customers, their English meaning, their status and history, who approved them; your chats with Agent OWL (what you ask and what it answers).", "Your business and your customers"],
              ["Your voice", "If you use the microphone, the recording is sent to a speech service to be turned into text (section 6). We do not keep the recording; the text becomes a chat message.", "You"],
              ["Records of use", "A security log of who did what in a workspace and when (sensitive values are logged by name only, not by content); a count of AI use and its cost (not its content); a short-lived record of sign-up attempts, to stop abuse; and, kept by our sign-in provider for each session, the time, your IP address and your browser type.", "You and your team"],
              ["Billing", "When you start a trial or a paid plan, the details needed to invoice you (business name, GST number if you give one, billing e-mail). Card or UPI details are taken by the payment provider and are not stored by us.", "You and your business"],
              ["On your device", "Cookies (section 13) and a few settings kept in your browser's own storage, such as whether the menu is collapsed. They stay on your device.", "You"],
            ],
          },
        },
        { p: "We do not collect your contacts or address book, your precise location, or any advertising or tracking data. We use no advertising and no analytics." },
      ],
    },
    {
      id: "types",
      title: "3. What else we keep for each type of business",
      blocks: [
        { p: "Some types of business keep more than the list above, because their work needs it. Only the type you choose when you sign up applies to you." },
        {
          table: {
            head: ["Type of business", "What it also keeps", "Care taken"],
            rows: [
              ["Saree and textile wholesale", "Your catalogue (names, prices and the photos you upload), store visits and bookings, call requests, quotes and orders for each customer.", "Photos are of sarees, not of people. Prices come from your price list by fixed rules, never from the AI."],
              ["Construction materials", "Customer sites (a site name, address line, city, PIN code, map point and access notes; a private site can be someone's home), delivery trips (vehicle number, driver's name and phone) and proof of delivery (who received the goods, and a photo that can show people), and a ledger of what each customer owes and has paid.", "Free-text fields refuse phone numbers and e-mail addresses. The AI does not read sites, trips or ledgers."],
              ["Schools and colleges", "Admission enquiries (the parent or guardian, the programme asked about, the stage reached), a record for each admitted student, fee plans and the fee ledger, and reminders to parents.", "Children's data follows the strict rules of section 10. A child who has not been admitted is not stored at all."],
            ],
          },
        },
        { p: "Money records (what was charged, paid, conceded or adjusted) are business records. They hold an account and an amount, not a name, and they are kept as accounting records when a person's other data is erased." },
      ],
    },
    {
      id: "why",
      title: "4. Why we use it, and on what basis",
      blocks: [
        {
          ul: [
            "To run the service for you: to let you sign in, keep your business's records, prepare quotes, drafts, reminders and orders, and show you what needs your attention.",
            "To keep it safe: to check who you are (including a second factor for Owners and Admins), keep each business's records apart from every other business, prevent abuse, and keep a log of actions.",
            "To respect your customers' choices: to remember who said no, and never draft or send to them. This is why a keyed fingerprint of an erased person's phone number or e-mail address is kept after erasure (section 9).",
            "To bill you and meet our tax and other legal duties, and to answer your requests under this policy.",
          ],
        },
        { p: "Under the DPDP Act we rely on your consent, which you give by ticking the box when you sign up (you can withdraw it, section 11), and on the uses the Act allows without consent, such as providing a service you asked for and meeting legal duties. For visitors in the EU or UK the legal bases are: performing our contract with you, our legitimate interest in running a safe service, our legal obligations, and your consent where we ask for it." },
        { p: "We use your data for these purposes only. We do not sell it and we do not use it for advertising." },
      ],
    },
    {
      id: "ai",
      title: "5. Agent OWL is an AI assistant",
      blocks: [
        { p: "Agent OWL, the assistant in {brand}, is an AI. It reads your business's records to answer your questions and to prepare drafts: replies, follow-ups, quotes, visit bookings and reminders. Messages it writes to your customers may be written by AI, and they are labelled as coming from the business's AI assistant." },
        { p: "The AI does not set or change prices (prices come from your price list by fixed rules). A message to a customer goes out only under the rules your business has switched on: money, promises and complaints always wait for a person's approval, a campaign is sent only after the Owner approves it, and a customer who has said stop is never contacted. A person stays responsible for what is sent." },
        { p: "To do this, your question and the records it needs (for example company names, message text and amounts) are sent to an AI model provider and processed there. The service is designed not to pass customer contact details (names, phone numbers, e-mail addresses) to the model, but free text such as enquiry messages and company names can contain personal data. A school's student records, and the names of children, are never sent to a model (section 10). We choose model providers whose terms do not allow them to train their models on the data we send." },
      ],
    },
    {
      id: "voice",
      title: "6. Voice",
      blocks: [
        { p: "The microphone is optional; you can always type. If you use it, your voice is sent to a speech service to be understood, and, if you chose spoken answers or voice notes, the approved written text is sent to it to be read aloud. We do not keep the recording. The words it was understood as are saved like any question you type. A child's name or label is never sent to a speech service." },
      ],
    },
    {
      id: "share",
      title: "7. Who else handles your data",
      blocks: [
        { p: "We do not sell personal data. These kinds of company handle it for us, only to provide the service:" },
        {
          table: {
            head: ["Kind of provider", "What for", "Where"],
            rows: [
              ["Database, sign-in and file storage (at present Supabase)", "Keeps the records, signs you in, stores the photos you upload", "Mumbai, India"],
              ["Hosting (at present Google Cloud)", "Runs the website and the service", "Mumbai, India"],
              ["AI model providers", "Answers and drafts (section 5)", "May be outside India (section 8)"],
              ["Speech services", "Turn your voice into text and approved text into speech (section 6), only if you use voice", "May be outside India (section 8)"],
              ["E-mail delivery", "Sends the sign-up confirmation and security e-mails", "May be outside India (section 8)"],
              ["Messaging platforms (WhatsApp, run by Meta)", "Only when a business connects its own WhatsApp number: the message text and the recipient's phone number go through WhatsApp to the customer. Nothing is sent to WhatsApp before a business does this.", "As Meta describes"],
              ["Payments", "Takes your card or UPI payment when a paid plan starts. We never see the full card number.", "As the payment provider describes"],
            ],
          },
        },
        { p: "We may also disclose data if the law or a court requires it. If the business is ever sold or merged, the data goes with the service on the same terms, and we will tell you first." },
      ],
    },
    {
      id: "where",
      title: "8. Where it is kept, and transfers abroad",
      blocks: [
        { p: "Your records are stored in India, in the Mumbai region of our database and hosting providers. Some providers listed above, such as AI model, speech, e-mail and messaging providers, may process the small part of the data they need outside India. That is a transfer abroad. The DPDP Act allows this except to countries the Government of India restricts. For visitors in the EU or UK, we use the safeguards the GDPR requires for a transfer." },
      ],
    },
    {
      id: "keep",
      title: "9. How long we keep it",
      blocks: [
        {
          table: {
            head: ["Data", "How long"],
            rows: [
              ["Account data", "While your account exists, and until we have finished deleting it after you ask."],
              ["A business's records (customers, enquiries, quotes, orders, messages, visits, catalogue)", "Until the Owner erases them (see section 11). There is no automatic deletion, except the student rule in section 10."],
              ["Chats with Agent OWL", "Until erased, as above."],
              ["Voice recordings", "Not kept."],
              ["Security log and usage counts", "Kept as a record of what happened. It holds no contact details or message text; the erasure of a company also removes that company's identity from it."],
              ["Do-not-contact keys", "When a customer is erased, a keyed fingerprint (not readable) of their phone number or e-mail address is kept so they are not contacted again. It is used only to block messages. This is arguably personal data, kept on purpose to honour their choice."],
              ["Invoices and payment records", "As long as the tax law requires us to keep them."],
              ["Backups", "Copies in backups age out after about 7 days. If we restore a backup, we repeat any erasures made since."],
              ["Exports you downloaded", "These are files on your side. We cannot erase them; the erasure result tells the Owner how many were made."],
            ],
          },
        },
      ],
    },
    {
      id: "children",
      title: "10. Children and schools",
      blocks: [
        { p: "{brand} is for businesses and adults; it is not meant for anyone under 18 to use, and we do not knowingly collect data from a child who signs up. If you think we have, write to {privacy_email} and we will erase it." },
        { p: "A school or college can use {brand} to run admissions, fees and messages to parents. The school is the data fiduciary for its students' data and is responsible for getting the consent of a parent or guardian that the law requires. For this we follow strict rules:" },
        {
          ul: [
            "Minimal fields. For a student we keep only a first name or initials (up to 30 characters, no digits) and the school's own admission number, with the programme and class. There is no field for a date of birth, photograph, home address, Aadhaar or any other identity number, health, religion, caste, income, marks, attendance, behaviour, a note, or a phone number or e-mail address of the child.",
            "Guardian contact only. The phone number and e-mail address belong to the parent or guardian, who is the contact. A child is never a contact and is never written to. Messages go to the guardian, in words the school approved.",
            "Never sent to AI models. A child's name or label and admission number are never given to an AI model or a speech service, never written to a log, and never put in a default export. The assistant works from the school's own words and amounts only.",
            "Fees are records, not profiles. A fee ledger holds an account, an amount and a receipt number, not a name. We build no profile of a child, track no behaviour, and show no advertising.",
            "Deletion. The school's Owner can erase a student at any time, and erasing the guardian also erases the child's name and number. The school can set how many months after a student leaves the name and number are removed automatically; the scheduler then removes them. Fee records stay as accounting records without the name.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "11. Your rights, and how to use them",
      blocks: [
        { p: "Under the DPDP Act you have the right to:" },
        {
          ul: [
            "get a summary of your personal data and how it is processed, and who it is shared with (access);",
            "have wrong or incomplete data corrected, and out-of-date data updated (correction);",
            "have your data erased (erasure);",
            "withdraw your consent at any time, as easily as you gave it; this does not undo what was done before, and some features then stop working;",
            "get a reply to a complaint (grievance redress), see section 12;",
            "name another person to exercise your rights if you die or cannot act (nomination);",
            "for visitors in the EU or UK: receive your data in a common format (in {brand}, a business can export its leads as CSV or JSON), ask us to restrict or stop certain uses, and complain to your data protection authority.",
          ],
        },
        { p: "How. Write to {privacy_email} and say what you want (access, correction, erasure or withdrawal). We may need to check who you are before we act. We will answer a request to access, correct or erase your data within {request_days} days, and any other request or complaint within {grievance_days} days. To ask for erasure, see also the page /data-deletion. If you are an Owner you can also erase one customer, one company or a whole workspace yourself in Settings, Privacy (Owners only, with a typed confirmation; a whole-workspace erasure has a 24-hour window in which an Owner or Admin can cancel it). If you are a customer or a parent of a business that uses {brand}, please contact that business first; it decides about your data and we will help it to act." },
        { p: "Limits you should know. Erasure is complete for structured data and for exact identifiers (a phone number or e-mail address, wherever it appears in the workspace's text). A name inside free text, such as a note that merely mentions a person, cannot be found with certainty; those places are listed for the Owner to review by hand. We cannot erase an export that was already downloaded, backups age out as described in section 9, and we keep what the law requires us to keep, such as invoices." },
      ],
    },
    {
      id: "grievance",
      title: "12. Grievance Officer",
      blocks: [
        { p: "If you have a complaint about how your personal data is handled, write to our Grievance Officer: {proprietor}, Stack19, at {privacy_email}. We will acknowledge your complaint and answer it within {grievance_days} days. A request to access, correct or erase your data is answered sooner, within {request_days} days (section 11). If you are not satisfied, you may complain to the Data Protection Board of India once it is in operation, or, in the EU or UK, to your data protection authority." },
      ],
    },
    {
      id: "cookies",
      title: "13. Cookies and similar storage",
      blocks: [
        { p: "We set only strictly necessary cookies: to keep you signed in and secure, and to remember your language, your light or dark choice, and your cookie choice. We set no advertising, tracking or analytics cookies and load no analytics. The cookie settings link at the bottom of every page shows the exact list and has an Analytics switch, which is off and will stay off unless we ever add analytics and you switch it on." },
        { p: "The list is: the sign-in cookie of our sign-in provider (sb-<project>-auth-token, up to 400 days or until you sign out), sme_lang (language, one year), sme_theme (light or dark, one year) and sme_consent (your cookie choice, one year). A few settings, such as whether the side menu is collapsed or spoken answers play automatically, are kept in your browser's own storage and never sent to us." },
      ],
    },
    {
      id: "security",
      title: "14. Security",
      blocks: [
        { p: "Each business's records are kept apart from every other business's by rules in the database itself. Owners and Admins must use a second factor. Access is limited to what each role needs, and a log records actions. No service can promise perfect security. If a breach of personal data happens, we will tell the people and the authorities affected as the law requires." },
      ],
    },
    {
      id: "changes",
      title: "15. Changes to this policy",
      blocks: [{ p: "When we change this policy we will give the new text a new version and date and, for a material change, tell you before it applies and ask you to accept it again. The version you accepted at sign-up is recorded with the time." }],
    },
  ],
};
