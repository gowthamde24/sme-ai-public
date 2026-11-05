import { notFound, redirect } from "next/navigation";

import { AssistantActivity } from "@/components/v2/app/settings/AssistantActivity";
import { WorkPreview } from "@/components/v2/app/today/ask/work/LazyWorkPreview";
import { pageMain } from "@/components/v2/app/ui";
import { PageTop } from "@/components/v2/app/parts";
import { wordsFor } from "@/i18n/app-words";
import { appT } from "@/i18n/app";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readActivity } from "@/lib/assistant-work/source";
import { requireUser } from "@/lib/auth/session";
import { assistantWorkScreens } from "@/lib/screens/flag";
import { BRAND_NAME } from "@/design/brand";

export const metadata = { title: `Assistant work cards · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/assistant-work-preview: the work cards of the chat and Settings > Activity with made-up data, for review and pictures. Only while ASSISTANT_WORK_SCREENS is `mock` (404 otherwise),
 * only for a member of the workspace, and linked from no menu. Nothing here reads or writes the workspace's data.
 */
export default async function AssistantWorkPreview({ params }: PageProps<"/app/tenants/[tenantId]/assistant-work-preview">) {
  if (assistantWorkScreens() !== "mock") notFound();
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const t = appT(lang);
  const base = `/app/tenants/${tenantId}`;
  const entries = await readActivity("mock", { token: user.accessToken, tenantId }, "week");
  return (
    <main className={pageMain}>
      <PageTop title={t("awp.title")} />
      <div className="mt-6 flex flex-col gap-8">
        <WorkPreview words={wordsFor(lang, ["bv.work.", "awp."], ["bv.bar.placeholder", "bv.chat.err.mfa", "bv.chat.err.forbidden", "bv.chat.err.down"])} base={base} />
        <div className="max-w-3xl">
          <AssistantActivity entries={entries} range="week" words={wordsFor(lang, ["asstact."])} lang={lang} base={base} canUndo mode="mock" />
        </div>
      </div>
    </main>
  );
}
