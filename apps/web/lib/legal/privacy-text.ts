import type { LegalText } from "./types";

/**
 * The Privacy notice (jobs BH, DB; rewritten by job DQ for India's DPDP Act 2023, version 2026-10-27): short, plain and itemised. What data and why, the two purposes (the service, and marketing which is separate and off), who processes it
 * (the list of providers is drawn from the API's `GET /v1/privacy/subprocessors` under section 5: the names and countries are not typed here), what leaves India, how long we keep it, your rights and how to withdraw, the Grievance Officer
 * and the Data Protection Board, and what we do after a breach. Names, e-mail addresses and the number of days are {tokens} filled from lib/site/business.ts (the one place they are written).
 * Telugu, Hindi and Kannada versions: privacy-text.te.ts, .hi.ts, .kn.ts (same section ids, same blocks): machine-written drafts for a native reader. English is the text that counts.
 */
export const PRIVACY: LegalText = {
  title: "Privacy notice",
  intro: [
    "This notice says what personal data {brand} keeps, why, who handles it, where it goes, how long we keep it, and how you use your rights. It is written for the owners and staff of Indian shops, builders' merchants and schools who use the service, for the customers and parents those businesses write to, and for people who visit our website.",
    "{brand} is provided by Stack19, {business_description} (\"we\", \"us\"). Write to {privacy_email} for anything in this notice.",
  ],
  sections: [
    {
      id: "roles",
      title: "1. Two roles",
      blocks: [
        {
          ul: [
            "Your account and your use of {brand} (you and your team: name, e-mail, sign-in details). We decide why and how this is used. For it we are the data fiduciary under India's DPDP Act 2023.",
            "Your customers' data (the people and companies a business enters as leads, customers, parents or guardians). The business decides why it keeps them. We only handle this data for the business, on its instructions, to run the service (we are its \"data processor\"). The business is its data fiduciary and is responsible for having the right to contact its customers.",
          ],
        },
      ],
    },
    {
      id: "collect",
      title: "2. What data, and why",
      blocks: [
        {
          table: {
            head: ["What", "Examples", "Why"],
            rows: [
              ["Account", "Your name, e-mail address, password (kept only as a one-way hash), the secret of your authenticator app, your role in a business (Owner, Admin, Sales, Viewer), language and light or dark choice, the version of this notice and of the Terms you accepted, and when. With Google or Facebook sign-in: the name and verified e-mail address that account shares with us.", "To let you sign in and use the service."],
              ["Business", "The business name, team members and roles, type of business, plan, opening times, quiet hours and sending settings.", "To run the service for the business."],
              ["Your customers", "Name, phone number, e-mail address, job title; company, city; whether each person agreed to be contacted by e-mail, WhatsApp or phone, and do-not-contact marks; enquiry text; quotes, orders and amounts; store visits; for a school, the records of section 8.", "To run the business's work: enquiries, quotes, follow-ups, orders, fees."],
              ["Extras of a business type", "Textile wholesale: catalogue photos (of sarees, not people), store visits and bookings. Construction materials: customer sites (name, address, PIN code, map point, access notes), delivery trips (vehicle number, driver's name and phone), proof of delivery (who received the goods, and a photo that can show people) and what each customer owes. Schools: section 8.", "To run the work that business type needs."],
              ["Messages and chats", "Messages drafted for or sent to customers, their status and history, who approved them; your chats with our AI assistant.", "To prepare and track messages; to answer you."],
              ["Voice", "If you use the microphone, the recording is sent to a speech service to become text. We do not keep the recording. If a business uses its own voice for calls, the recorded sentence and sample are kept until the Owner deletes them.", "To understand what you say and to speak for the business."],
              ["Records of use", "A security log of who did what in a workspace and when (sensitive values by name only, not by content); counts of AI use and cost; short-lived records of sign-up attempts; the time, IP address and browser type of each session, kept by our sign-in provider.", "To keep the service safe and to stop abuse."],
              ["Billing", "Business name, GST number if you give one, billing e-mail. Card or UPI details are taken by the payment provider and are not stored by us.", "To invoice you and meet tax duties."],
              ["Website visitors", "If you book a demo or join the waitlist: your name, kind of business, city, phone number or e-mail, preferred language, and whether you ticked the box for news and offers. If you write to us: what you send.", "To contact you about a demo, and about your place when the service opens."],
              ["On your device", "Cookies and a few settings kept in your browser's own storage (section 11). They stay on your device.", "To keep you signed in and remember your choices."],
            ],
          },
        },
        { p: "We do not collect your contacts or address book, your precise location, or advertising or tracking data. We use no advertising and no analytics. We do not sell personal data." },
      ],
    },
    {
      id: "consent",
      title: "3. Consent: the service, and marketing",
      blocks: [
        {
          ul: [
            "The service. To create an account you agree to the Terms and confirm you have read this notice. We keep the version you saw and the time. This consent is the account itself: it ends when you delete the account.",
            "Marketing. News and offers about {brand} are a separate choice. The box is never ticked for you and nothing depends on it. You can switch it on or off at any time in Settings, Privacy and data, as easily as you gave it, and it takes effect at once. We keep each choice with the version of this notice and the time.",
            "We also rely on the uses the Act allows without consent, such as providing a service you asked for and meeting legal duties.",
          ],
        },
      ],
    },
    {
      id: "ai",
      title: "4. Our assistant is an AI",
      blocks: [
        { p: "The assistant in {brand} is an AI. It reads the business's records to answer questions and to prepare drafts: replies, follow-ups, quotes, visit bookings and reminders. Messages and calls it makes for a business say they come from the business's AI assistant." },
        { p: "The AI never sets prices (they come from the business's price list by fixed rules). A message goes out only under the rules the business has switched on: money, promises and complaints always wait for a person's approval, a campaign is sent only after the Owner approves it, and a customer who said stop is never contacted." },
        { p: "To do this, your question and the records it needs (such as company names, message text and amounts) are sent to an AI model provider. The service is designed not to pass customer contact details to the model, but free text such as an enquiry can contain personal data. A school's student records and children's names are never sent to a model or a speech service (section 8)." },
      ],
    },
    {
      id: "share",
      title: "5. Who processes your data",
      blocks: [
        { p: "These companies handle personal data for us, only to provide the service. The list below is read from our service when you open this page, so it is always the list in use:" },
        { p: "We may also disclose data if the law or a court requires it. If the business is ever sold or merged, the data goes with the service on the same terms, and we will tell you first." },
      ],
    },
    {
      id: "where",
      title: "6. Where your data goes, and abroad",
      blocks: [
        { p: "The list in section 5 gives the country of each provider. Where it is not India, the data that provider needs leaves India. That is a transfer abroad. The DPDP Act allows it except to countries the Government of India restricts. For visitors in the EU or UK we use the safeguards the GDPR requires." },
        { p: "A provider only gets what it needs for its purpose. WhatsApp, run by Meta, is used only when a business connects its own WhatsApp number: the message text and the recipient's number go through it to the customer." },
      ],
    },
    {
      id: "keep",
      title: "7. How long we keep it",
      blocks: [
        {
          table: {
            head: ["Data", "How long"],
            rows: [
              ["Account data", "While your account exists. If you delete the account, it is erased after the {cancel_days} days you have to cancel."],
              ["A business's records", "Until the Owner erases them, or the workspace is erased. A workspace whose plan lapsed is read-only for {lapsed_days} days; we e-mail the Owner {erasure_warning_hours} hours before erasing it, then erase it."],
              ["Chats with the AI assistant", "As the business's records."],
              ["Voice recordings", "Not kept. A voice a business recorded for its own calls is kept until the Owner deletes it."],
              ["Security and audit log", "At least one year ({log_days} days), then purged. It holds no contact details or message text."],
              ["Do-not-contact keys", "When a customer is erased, a keyed fingerprint (not readable) of their phone number or e-mail is kept only so they are never contacted again."],
              ["Website enquiries (demo, waitlist)", "Until you ask us to delete them, or until we have answered and you no longer want to be on the list."],
              ["Invoices and payment records", "As long as the tax law requires."],
              ["Backups", "Copies age out after about 7 days. If we restore a backup, we repeat any erasures made since."],
            ],
          },
        },
      ],
    },
    {
      id: "children",
      title: "8. Children and schools",
      blocks: [
        { p: "{brand} is for businesses and adults. It is not meant for anyone under 18 to use, and we do not knowingly collect data from a child who signs up. If you think we have, write to {privacy_email} and we will erase it." },
        { p: "A school can use {brand} for admissions, fees and messages to parents. The school is the data fiduciary for its students' data and is responsible for the parent's or guardian's consent the law requires. For this we follow strict rules:" },
        {
          ul: [
            "Minimal fields. For a student: a first name or initials and the school's admission number, with the programme and class. There is no field for date of birth, photograph, address, Aadhaar, health, religion, caste, income, behaviour or the child's own phone or e-mail.",
            "Guardian contact only. The phone number and e-mail belong to the parent or guardian. A child is never a contact and never written to.",
            "Never sent to AI. A child's name or label and admission number are never given to an AI model or a speech service, never written to a log, and never put in a default export. Marks and progress messages are filled from the file the school uploads, shown to the school before sending, and are not stored by us.",
            "Fees are records, not profiles. We build no profile of a child, track no behaviour and show no advertising.",
            "Deletion. The school's Owner can erase a student at any time.",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "9. Your rights, and how to withdraw",
      blocks: [
        { p: "You have the right to: see a summary of your personal data and who it is shared with (access); correct wrong data; have your data erased; withdraw consent at any time; get a reply to a complaint; and name another person to act for you if you die or cannot act (nomination). Visitors in the EU or UK may also receive their data in a common format and ask us to restrict certain uses." },
        {
          ul: [
            "In the app, Settings, Privacy and data: download my data (a file with each table as JSON and CSV), delete my account, switch marketing on or off, and send us a grievance. Owners can also erase one customer, one company or a whole workspace.",
            "Delete my account: you type your e-mail to confirm; nothing is erased for {cancel_days} days, and you can cancel in that time. Then it is erased and the deletion is logged.",
            "By e-mail: write to {privacy_email} and say what you want (access, correction, erasure or withdrawal). We may need to check who you are first. We answer a request to access, correct or erase your data within {request_days} days. We act on a withdrawal of consent within {withdrawal_hours} hours: we stop messages, calls and campaigns to you. The do-not-contact option in the app takes effect immediately. See also the page /data-deletion.",
            "If you are a customer or a parent of a business that uses {brand}, please contact that business first: it decides about your data and we will help it to act.",
          ],
        },
        { p: "What erasure cannot do: a name inside free text, such as a note that only mentions a person, cannot be found with certainty (those places are listed for the Owner to review); we cannot erase an export you already downloaded; and we keep what the law requires, such as invoices." },
      ],
    },
    {
      id: "grievance",
      title: "10. Grievance Officer, and the Data Protection Board",
      blocks: [
        { p: "If you have a complaint about your personal data, write to our Grievance Officer: {proprietor}, Stack19, at {privacy_email}, or use \"Raise a grievance\" in Settings, Privacy and data. We acknowledge it at once and answer within {grievance_days} days. A request to access, correct or erase your data is answered sooner, within {request_days} days." },
        { p: "If you are not satisfied, you have the right to complain to the Data Protection Board of India. Visitors in the EU or UK may complain to their data protection authority." },
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies and similar storage",
      blocks: [
        { p: "We set only strictly necessary cookies: to keep you signed in and secure, and to remember your language, your light or dark choice, and your cookie choice. We set no advertising, tracking or analytics cookies and load no analytics. The cookie settings link at the bottom of every page shows the exact list and has an Analytics switch, which is off and stays off unless we ever add analytics and you switch it on." },
        { p: "The list is: the sign-in cookie of our sign-in provider (sb-<project>-auth-token, up to 400 days or until you sign out), sme_lang (language, one year), sme_theme (light or dark, one year) and sme_consent (your cookie choice, one year). A few settings, such as whether the side menu is collapsed, are kept in your browser's own storage and never sent to us." },
      ],
    },
    {
      id: "security",
      title: "12. Security, and if something goes wrong",
      blocks: [
        { p: "Each business's records are kept apart from every other business's by rules in the database itself. Owners and Admins must use a second factor. Access is limited to what each role needs, and a log records actions. No service can promise perfect security." },
        { p: "If a breach of personal data happens, we contain it, tell the Data Protection Board of India and the people affected without delay, and send the Board a detailed report within 72 hours." },
      ],
    },
    {
      id: "changes",
      title: "13. Changes to this notice",
      blocks: [{ p: "When we change this notice it gets a new version and date. For a material change we tell you before it applies and ask you to accept it again. The version you accepted is kept with the time." }],
    },
  ],
};
