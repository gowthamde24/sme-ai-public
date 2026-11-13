import { notFound, redirect } from "next/navigation";

import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { PageHeader } from "@/components/v2/app/ds/PageHeader";
import { StatusPill } from "@/components/v2/app/ds/StatusPill";
import { GoLiveButton } from "@/components/v2/app/my-assistant/GoLiveButton";
import { GoLivePanel, STATE_PILL } from "@/components/v2/app/my-assistant/GoLivePanel";
import { PracticePanel } from "@/components/v2/app/my-assistant/LazyMyAssistant";
import { MyAssistantTabs } from "@/components/v2/app/my-assistant/MyAssistantTabs";
import { tabOf } from "@/components/v2/app/my-assistant/tabs";
import { ApiDownV2, NotShownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { readAssistantStatus } from "@/lib/assistant-status/source";
import { CALL_LANG_NAMES, CALL_LANGS, type CallLang } from "@/lib/assistant/types";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import { appV4, assistantStatusScreens, designV6, talkTrainingScreens, teachScreens, testCallScreens } from "@/lib/screens/flag";

import { goLiveAction, pauseAction } from "../my-assistant-actions";
import { practiceCallAction } from "../talk-training-actions";
import { teachAction, undoTeachAction } from "../teach-actions";
import { readKnowledgeTab, readRulesTab, readVoiceTab } from "./my-assistant-data";
import { knowledgeTab, practiceTab, rulesTab, voiceTab } from "./tab-bodies";
import { partsWords } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";

export const metadata = { title: `My assistant · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const uiCall = (lang: Lang): CallLang => ((CALL_LANGS as readonly string[]).includes(lang) ? (lang as CallLang) : "en");

/**
 * /app/tenants/[tenantId]/my-assistant (DESIGN_V6; the Owner and Admin): the assistant's own page. The header shows its state (Not live / In training / Live) and, for the Owner, Go live / Pause; the tabs are Knowledge, Voice & tone, Rules, Practice and Go live, each with "Using defaults" while its part has not been
 * changed; the Practice panel sits on the right of every tab. The tabs REUSE the working parts of Settings > AI assistant, Train how it talks and the Lead Desk setup. A plain 404 where DESIGN_V6 is off; the old pages keep working.
 */
export default async function MyAssistantPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/my-assistant">) {
  const { tenantId } = await params;
  if (!designV6() || !isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
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
  const t = appT(lang) as (key: string, vars?: Record<string, string | number>) => string;
  const base = `/app/tenants/${tenantId}`;
  if (tenant.role !== "owner" && tenant.role !== "admin") return <NotShownV2 tenantId={tenantId} tenantName={tenant.name} title={t("mya.title")} message={t("mya.rolesonly")} />;
  const owner = tenant.role === "owner";
  const tab = tabOf((await searchParams).tab);
  const status = await readAssistantStatus(user.accessToken, tenantId);
  const common = { lang, t, tenantId, base, owner };
  const ctx = { token: user.accessToken, tenantId, userId: user.id, modules: tab === "rules" ? ((await readPackCached(user.accessToken, tenantId).catch(() => null))?.modules ?? null) : null };

  const act = async (what: "go-live" | "pause") => (what === "go-live" ? goLiveAction(tenantId) : pauseAction(tenantId));
  const buttonWords = wordsFor(lang, ["mya.missing.", "mya.err.", "mya.live", "mya.pause", "mya.golive", "mya.working", "mya.owneronly"]);
  const goLive = status ? <GoLiveButton words={buttonWords} state={status.state} canGoLive={status.canGoLive} missing={status.missing} owner={owner} act={act} base={base} /> : null;

  const language = uiCall(lang);
  const teach = teachScreens() !== "off" ? { save: teachAction.bind(null, tenantId), undo: undoTeachAction.bind(null, tenantId) } : null;
  const body =
    tab === "knowledge" ? (
      knowledgeTab({ ...common, data: await readKnowledgeTab(ctx), business: tenant.name })
    ) : tab === "voice" ? (
      voiceTab({ ...common, data: await readVoiceTab(ctx), business: tenant.name })
    ) : tab === "rules" ? (
      rulesTab({ ...common, data: await readRulesTab(ctx) })
    ) : tab === "practice" ? (
      practiceTab({ t })
    ) : (
      <GoLivePanel words={wordsFor(lang, ["mya.g.", "mya.missing.", "mya.tab.", "nav.assistant."])} base={base} status={status} button={goLive} mock={assistantStatusScreens() === "mock"} />
    );
  return (
    <main className={pageMain} lang={lang}>
      {helpTipFor(lang, base, "myassistant", true)}
      <PageHeader
        title={t("mya.title")}
        sub={t("mya.sub")}
        badge={status ? <StatusPill status={STATE_PILL[status.state]}>{t(`nav.assistant.${status.state}`)}</StatusPill> : null}
        right={goLive}
      />
      <div className="mt-5">
        <MyAssistantTabs words={wordsFor(lang, ["mya.tab", "mya.defaults"])} base={base} current={tab} usingDefaults={status?.usingDefaults ?? []} />
      </div>
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <div className="min-w-0">{body}</div>
        <PracticePanel
          words={wordsFor(lang, ["mya.p.", "dst.", "tt.practice."])}
          language={language}
          langName={CALL_LANG_NAMES[language]}
          practice={talkTrainingScreens() ? practiceCallAction.bind(null, tenantId) : null}
          teach={teach}
          testCallHref={appV4() && testCallScreens() && owner ? `${base}/calls?test=1` : null}
        />
      </div>
    </main>
  );
}
