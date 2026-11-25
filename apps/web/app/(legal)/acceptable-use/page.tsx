import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getSiteLang } from "@/i18n/get-lang";
import { legalMetadata } from "@/lib/legal/page-metadata";
import { legalDraftPages } from "@/lib/screens/flag";

export async function generateMetadata(): Promise<Metadata> {
  // a draft is never indexed
  return legalMetadata("/acceptable-use", "Acceptable Use Policy", "What you may and may not do when you call or message people with the service. Draft.", false);
}

export const dynamic = "force-dynamic";

/** /acceptable-use: the Acceptable Use Policy, a DRAFT (owner approves legal texts; lib/legal/aup-text.ts). It exists only where LEGAL_DRAFT_PAGES is on (staging); everywhere else it is a plain 404. English only. */
export default async function AcceptableUsePage() {
  if (!legalDraftPages()) notFound();
  return <LegalDoc id="aup" lang={await getSiteLang()} />;
}
