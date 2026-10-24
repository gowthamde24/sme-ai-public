import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { legalMetadata } from "@/lib/legal/page-metadata";

export const metadata: Metadata = legalMetadata("/privacy", "Privacy Policy", "What personal data is kept, why, where it is stored in India, who handles it and how to use your rights.");

/** /privacy (jobs BH, DB): the Privacy Policy, from the data inventory of docs/data-inventory.md, in all four languages (Telugu, Hindi and Kannada are machine-written drafts awaiting a native reader; the page says so). A stable address: Meta and Google review it. */
export default async function PrivacyPage() {
  return <LegalDoc id="privacy" lang={await getLang()} summaryKeys={["legal.sum.privacy.1", "legal.sum.privacy.2", "legal.sum.privacy.3", "legal.sum.privacy.4", "legal.sum.privacy.5", "legal.sum.privacy.6"]} />;
}
