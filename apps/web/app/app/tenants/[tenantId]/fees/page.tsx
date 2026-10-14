import { notFound } from "next/navigation";

import { SoonPage } from "@/components/v2/app/start/SoonPage";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Fees · SME AI Revenue Engine" };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/fees: a part the business type has switched on and that is not built yet (job CL). The module guard of the workspace's template has already answered 403 for a business type without it. Says
 * "Not available yet" and nothing else.
 */
export default async function Page({ params }: PageProps<"/app/tenants/[tenantId]/fees">) {
  await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const lang = await getLang();
  return <SoonPage which="fees" base={`/app/tenants/${tenantId}`} lang={lang} t={appT(lang)} />;
}
