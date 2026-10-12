import { notFound, redirect } from "next/navigation";

import { HelpIndex } from "@/components/v2/app/help/HelpScreens";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { appT } from "@/i18n/app";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Help · SME AI Revenue Engine" };
// Per-user: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/help: the short guides (job BT). Every member of the workspace may read them; they show no customer data. */
export default async function HelpPage({ params }: PageProps<"/app/tenants/[tenantId]/help">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  return (
    <main className={pageMain} lang={lang}>
      <HelpIndex t={appT(lang)} base={`/app/tenants/${tenantId}`} lang={lang} />
    </main>
  );
}
