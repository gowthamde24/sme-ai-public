import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { TERMS } from "@/lib/legal/terms-text";

export const metadata: Metadata = { title: "Terms of Use", description: "The terms for using the service.", robots: { index: false, follow: false } };

/** /terms (job BH): the Terms of Use. A draft, pending legal review, until the owner switches the banner off (lib/legal/version.ts). */
export default async function TermsPage() {
  return <LegalDoc doc={TERMS} lang={await getLang()} summaryKeys={["legal.sum.terms.1", "legal.sum.terms.2", "legal.sum.terms.3", "legal.sum.terms.4"]} />;
}
