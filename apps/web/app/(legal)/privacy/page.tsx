import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { SubprocessorList } from "@/components/v2/legal/SubprocessorList";
import { getLang } from "@/i18n/get-lang";
import { subprocessorsCached } from "@/lib/api/dpdp";
import { legalMetadata } from "@/lib/legal/page-metadata";
import { requestIndexable } from "@/lib/seo/index-rule";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("/privacy", "Privacy notice", "What personal data is kept, why, who handles it and how to use your rights.", await requestIndexable());
}

/** /privacy (jobs BH, DB): the Privacy Policy, from the data inventory of docs/data-inventory.md, in all four languages (Telugu, Hindi and Kannada are machine-written drafts awaiting a native reader; the page says so). A stable address: Meta and Google review it. */
export default async function PrivacyPage() {
  const lang = await getLang();
  // the companies that process data come from the API (job DQ part 2): never typed into the text; a read that fails says so
  const processors = await subprocessorsCached().catch(() => null);
  return <LegalDoc id="privacy" lang={lang} extras={{ share: <SubprocessorList data={processors} lang={lang} /> }} summaryKeys={["legal.sum.privacy.1", "legal.sum.privacy.2", "legal.sum.privacy.3", "legal.sum.privacy.4", "legal.sum.privacy.5", "legal.sum.privacy.6"]} />;
}
