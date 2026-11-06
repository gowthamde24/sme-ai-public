import { notFound, redirect } from "next/navigation";

import { TalkTraining } from "@/components/v2/app/assistant/LazyTalkTraining";
import { ApiDownV2, NotShownV2, PageTop } from "@/components/v2/app/parts";
import { pageMain, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { ApiAuthError, ApiRequestError, fetchTenant, publicApiBase } from "@/lib/api/client";
import { voiceSocketUrl } from "@/lib/browser-voice/protocol";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { getTalkTraining } from "@/lib/api/talk-training";
import { requireUser } from "@/lib/auth/session";
import { appV4, talkTrainingScreens } from "@/lib/screens/flag";

import { menuTitle } from "../../menu-title";
import { practiceCallAction, resetTalkTrainingAction, saveTalkTrainingAction } from "../../talk-training-actions";

export const metadata = { title: `Train how it talks · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/ai-team/training (AI team > Train how it talks; the Owner's): "How I talk to customers" on a page of its own (owner rule, 6 Nov: every menu item opens its own page; the panel left Settings > AI assistant, which
 * links here). C1's talk-training (docs/contracts/talk-training.md): the greeting, how to address people, the questions, the words never to say, answers to objections, good examples and the platform's rules read-only. A part the API cannot
 * read says so in plain words, never "Not available yet".
 */
export default async function TrainingPage({ params }: PageProps<"/app/tenants/[tenantId]/ai-team/training">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const t = appT(lang);
  const title = await menuTitle("train", lang, user.accessToken, tenantId);
  if (tenant.role !== "owner") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={title} message={t("tt.owneronly")} />;
  // practice by voice (app v4, C1 #402): the Live talk socket of this workspace
  const voiceUrl = appV4() ? voiceSocketUrl(publicApiBase(), tenantId) : null;
  const training = talkTrainingScreens() ? await getTalkTraining(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={title} sub={t("tt.sub")} />
      <div className="mt-6 max-w-3xl">
        {training ? (
          <TalkTraining
            words={wordsFor(lang, ["tt.", "bv.end."], ["today.err.mfa.link"])}
            initial={training}
            langNames={CALL_LANG_NAMES}
            canEdit
            securityHref="/app/security"
            business={tenant.name}
            actions={{ save: saveTalkTrainingAction.bind(null, tenantId), reset: resetTalkTrainingAction.bind(null, tenantId) }}
            v4={appV4()}
            practice={appV4() ? practiceCallAction.bind(null, tenantId) : null}
            voice={voiceUrl ? { url: voiceUrl, tokenUrl: `/app/tenants/${tenantId}/ai-team/training/practice-token` } : null}
          />
        ) : (
          <section className={surface} data-part="tt-unread">
            <p className="text-base text-muted">{t("tt.unread")}</p>
          </section>
        )}
      </div>
    </main>
  );
}
