import type { LegalText } from "./types";

/**
 * The data-deletion page (job DB, /data-deletion): how to ask for your data to be deleted. Meta and Google ask every app for a public page like this. Same shape as the Privacy Policy and the same {tokens} (lib/site/business.ts);
 * Telugu, Hindi and Kannada versions: data-deletion-text.te.ts, .hi.ts, .kn.ts (same section ids). Written from what the product really does: docs/runbooks/privacy-rights.md and the Privacy section of Settings.
 */
export const DATA_DELETION: LegalText = {
  title: "Delete your data",
  intro: [
    "This page explains how to ask {brand} to delete your personal data. You can do it yourself in the app, or by writing to us. If you signed in with Google or Facebook, the same steps apply.",
  ],
  sections: [
    {
      id: "app",
      title: "1. Delete it yourself, in the app",
      blocks: [
        {
          ul: [
            "Your account: sign in, open Settings, then Privacy, then delete my account. You type your e-mail address to confirm. The deletion happens after 14 days, so you can change your mind; you can cancel it in the same place during those days.",
            "Your business's records (Owners only, with the second factor): in Settings, Privacy, you can erase one customer, one company, or the whole workspace. A whole-workspace erasure also has a cancel window of 24 hours.",
            "Download first, if you want a copy: Settings, Privacy, download my data.",
          ],
        },
      ],
    },
    {
      id: "email",
      title: "2. Ask us by e-mail",
      blocks: [
        { p: "Write to {privacy_email} from the e-mail address of your account, with the subject \"Delete my data\". Say what you want deleted: your account, a business's records, or the details of one person (a customer or a parent). If you cannot sign in, write from any address and tell us the e-mail address of the account; we will check who you are before we act." },
        { p: "If you are a customer or a parent of a business that uses {brand}, you can also ask us directly. We will pass your request to that business, which decides about your data, and we help it to act." },
        { p: "We answer a request to delete your data within {request_days} days. Any other complaint about your data is answered within {grievance_days} days." },
        { p: "If you only want to stop being contacted, you do not have to delete anything. Write to {privacy_email} and say so: we stop messages, calls and campaigns to you within {withdrawal_hours} hours. The do-not-contact option in the app takes effect immediately." },
      ],
    },
    {
      id: "what",
      title: "3. What is deleted, and what is kept",
      blocks: [
        {
          ul: [
            "Deleted or made anonymous: your name, e-mail address, phone numbers, enquiry text, messages, drafts, notes and chats with our AI assistant, and, for a school, the student's name or initials and admission number.",
            "Kept, without your name: accounting records such as invoices, receipts and payment amounts, because the law requires them; the security log; and a keyed fingerprint (not readable) of a phone number or e-mail address that has asked not to be contacted, used only to make sure nothing is sent to it again.",
            "Backups age out after about 7 days. If a backup is restored, the deletion is repeated.",
            "A file you already downloaded is yours; we cannot delete it.",
          ],
        },
        { p: "More detail is in the Privacy Policy, sections 9 and 11." },
      ],
    },
  ],
};
