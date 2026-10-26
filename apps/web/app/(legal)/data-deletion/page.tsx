import type { Metadata } from "next";

import { LegalDoc } from "@/components/v2/legal/LegalDoc";
import { getLang } from "@/i18n/get-lang";
import { legalMetadata } from "@/lib/legal/page-metadata";
import { requestIndexable } from "@/lib/seo/index-rule";

export async function generateMetadata(): Promise<Metadata> {
  return legalMetadata("/data-deletion", "Delete your data", "How to ask for your account or your data to be deleted: in the app, or by e-mail.", await requestIndexable());
}

/** /data-deletion (job DB): how to ask for deletion (the in-app way and the e-mail way). The "data deletion instructions" address that Meta and Google ask every app for. */
export default async function DataDeletionPage() {
  return <LegalDoc id="data-deletion" lang={await getLang()} summaryKeys={["legal.sum.deletion.1", "legal.sum.deletion.2", "legal.sum.deletion.3"]} />;
}
