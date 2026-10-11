import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { PRIVACY } from "@/lib/legal/privacy-text";

export const metadata: Metadata = { title: "Privacy Policy", description: "What personal data is kept, why, who handles it and how to use your rights.", robots: { index: false, follow: false } };

/** /privacy (job BH): the Privacy Policy, from the data inventory of docs/data-inventory.md. A draft, pending legal review, until the owner switches the banner off (lib/legal/version.ts). */
export default async function PrivacyPage() {
  return <LegalDoc doc={PRIVACY} lang={await getLang()} summaryKeys={["legal.sum.privacy.1", "legal.sum.privacy.2", "legal.sum.privacy.3", "legal.sum.privacy.4", "legal.sum.privacy.5"]} />;
}
