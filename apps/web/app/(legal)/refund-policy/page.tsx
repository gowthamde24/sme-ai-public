import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { legalMetadata } from "@/lib/legal/page-metadata";
import { legalDraftPages } from "@/lib/screens/flag";

export async function generateMetadata(): Promise<Metadata> {
  // a draft is never indexed
  return legalMetadata("/refund-policy", "Refund and Cancellation Policy", "When you can cancel, and when we refund. Draft.", false);
}

export const dynamic = "force-dynamic";

/** /refund-policy: the Refund and Cancellation Policy, a DRAFT (owner's D13; lib/legal/refund-text.ts). It exists only where LEGAL_DRAFT_PAGES is on (staging); everywhere else it is a plain 404. English only; always under the draft banner. */
export default async function RefundPolicyPage() {
  if (!legalDraftPages()) notFound();
  return <LegalDoc id="refund" lang={await getLang()} />;
}
