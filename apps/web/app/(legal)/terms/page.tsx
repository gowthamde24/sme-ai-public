import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { legalMetadata } from "@/lib/legal/page-metadata";

export const metadata: Metadata = legalMetadata("/terms", "Terms of Use", "The terms for using the service: the free trial, payment, cancelling, acceptable use and the law that applies.");

/** /terms (jobs BH, DB): the Terms of Use. English text with a summary in the visitor's language. A stable address: Meta and Google review it. */
export default async function TermsPage() {
  return <LegalDoc id="terms" lang={await getLang()} summaryKeys={["legal.sum.terms.1", "legal.sum.terms.2", "legal.sum.terms.3", "legal.sum.terms.4"]} />;
}
