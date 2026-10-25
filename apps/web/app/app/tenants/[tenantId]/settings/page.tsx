import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeChoice, type ThemePick } from "@/components/v2/controls/ThemeChoice";
import { UsageCard, planText } from "@/components/v2/app/frame-parts";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { ApiDownV2, PageTop, Pill, SectionTabs } from "@/components/v2/app/parts";
import { breakAll, link, listPlain, memberRow, youMark, mutedText, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { appT, frameLabels } from "@/i18n/app";
import { authT } from "@/i18n/auth";
import { getLang } from "@/i18n/get-lang";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { SchedulerCard, SystemSwitchCard } from "@/components/v2/app/agent-settings/AgentStatusCards";
import { QuietHoursForm, RemindersForm, SendingForm } from "@/components/v2/app/agent-settings/AgentSettingsForms";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { escalate } from "@/lib/api/failure";
import { getOutboxSettings, type OutboxSettings } from "@/lib/api/outbox";
import { getSchedulerSettings, getSchedulerStatus, type SchedulerSettings, type SchedulerStatus } from "@/lib/api/scheduler";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchMembers, type Member } from "@/lib/api/orders";
import { type Plan } from "@/lib/api/plan";
import { type AiUsage } from "@/lib/api/ai-usage";
import { requireUser } from "@/lib/auth/session";

import { readPlanCached, readUsageCached } from "../../../frame-data";
import { PartProblem } from "@/components/v2/app/cc/PartProblem";
import { DataSection } from "@/components/v2/app/data/DataSection";
import { GstinForm } from "@/components/v2/app/gstin/GstinForm";
import { getBusinessProfile } from "@/lib/api/gstin";
import { PrivacySection } from "@/components/v2/app/privacy/PrivacySection";
import { readConsentList } from "@/lib/api/consent-list";
import { listMyDeletions, listMyExports, listWorkspaceDeletions } from "@/lib/api/privacy";
import { getCalendarFeed, getExportFormats, listImportJobs, type CalendarFeed, type ExportFormat, type ImportJob } from "@/lib/api/data";
import { settle, type Part } from "@/lib/api/part";

import { FieldsSection } from "@/components/v2/app/fields/FieldsSection";
import { readPackCached } from "@/lib/packs/read";
import { withModuleWords } from "@/lib/packs/module-words";
import { listCustomFields } from "@/lib/api/custom-fields";
import { usesChecklist } from "@/lib/packs/activation";
import type { FieldEntity, WorkspaceField } from "@/lib/packs/types";

import { addFieldAction, setFieldActiveAction, updateFieldAction } from "./field-actions";
import { saveQuietHoursAction, saveRemindersAction, saveSendingAction } from "./agent-settings-actions";
import { makeCalendarFeedAction, revokeCalendarFeedAction } from "./data-actions";
import { saveShopGstinAction } from "./gstin-actions";
import { cancelAccountDeletionAction, cancelWorkspaceDeletionAction, executeWorkspaceDeletionAction, exportLinkAction, getExportAction, requestAccountDeletionAction, requestExportAction, requestWorkspaceDeletionAction } from "./privacy-actions";
import { agentWords } from "./agent-words";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { BRAND_NAME } from "@/design/brand";
import { ADDRESSES } from "@/lib/site/business";
import { PlanSection } from "@/components/v2/app/plan/PlanSection";
import { AssistantSettings } from "@/components/v2/app/assistant/AssistantSettings";
import { assistantProfile } from "@/lib/assistant/defaults";
import { readAssistant } from "@/lib/assistant/source";
import { CALL_LANGS, VOICES } from "@/lib/assistant/types";
import { LANGUAGE_NAMES } from "@/i18n/lang";
import { assistantScreens } from "@/lib/screens/flag";
import { saveAssistantAction } from "../assistant-actions";
import { FAKE_CHECKOUT, planScreens } from "@/lib/plan/flag";
import { CATALOGUE, planById } from "@/lib/plan/catalogue";
import { readCatalogue, readWorkspacePlan } from "@/lib/plan/source";
import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, startPlanAction } from "../plan-actions";

export const metadata = { title: `Settings · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const SECTIONS = ["business", "plan", "members", "fields", "data", "language", "assistant", "agent", "security", "privacy"] as const; // plan-id-ok: "business" is the Business settings tab, not the Business plan
type Section = (typeof SECTIONS)[number];
/** The moment the page is drawn (ms), read once. */
const clock = (): number => Date.now();
/** A read that failed is null (the card says "Not available yet"); a rejected session is thrown so the page can send the person to sign in. */
function rethrowAuth(error: unknown): null {
  if (error instanceof ApiAuthError) throw error;
  return null;
}
function UnreadCard({ note }: { note: string }) {
  return (
    <section className={surface}>
      <p className="text-sm text-muted">{note}</p>
    </section>
  );
}
const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/settings, one part at a time (?section=): the business and its plan, the members (a list: nobody is added here), the language and the look, the security of the
 * person's sign-in, and privacy (the way to the erasure and suppression pages). The plan and the AI usage come from getPlan() / getAiUsage() of lib/api (Job AD); one that cannot be read says "Not available yet", and the
 * AI usage is shown to Owner and Admin only (the API refuses the others). The security and privacy words stay English until a person reviews them.
 */
export default async function SettingsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/settings">) {
  const user = await requireUser();
  const { tenantId } = await params;
  const query = await searchParams;
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
  const labels = frameLabels(lang);
  const wanted = pick(query.section);
  const base = `/app/tenants/${tenantId}`;
  const words = agentWords(lang);
  const admin = tenant.role === "owner" || tenant.role === "admin";
  // the extra fields of the business type (job CL): a part of Settings for the people who run the business, only when the business has customers or a catalogue to put them on
  const pack = await readPackCached(user.accessToken, tenantId);
  const fieldEntities = pack ? (([pack.modules.includes("contacts") ? "contact" : null, pack.modules.includes("catalogue") ? "catalogue_item" : null].filter(Boolean)) as FieldEntity[]) : [];
  const fieldList: WorkspaceField[] | null = admin && fieldEntities.length > 0 ? await listCustomFields(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  // a workspace that existed before business types and has no field of its own keeps the Settings it always had; one made with a chosen business type, or that has fields, gets the tab
  const hasFields = admin && fieldEntities.length > 0 && (usesChecklist(pack) || (fieldList !== null && fieldList.length > 0));
  // the Plan part (job DK): only while the feature flag is on, and only for the people who run the business
  const hasPlan = admin && planScreens() !== "off";
  // Settings > AI assistant (job DM): only while its flag is on, and only for the Owner (the people who run the business may be admins, but the assistant is the Owner's to set up)
  const hasAssistant = tenant.role === "owner" && assistantScreens() !== "off";
  const section: Section = (SECTIONS as readonly string[]).includes(wanted ?? "") && !(wanted === "agent" && tenant.role !== "owner") && !(wanted === "fields" && !hasFields) && !(wanted === "plan" && !hasPlan) && !(wanted === "assistant" && !hasAssistant) ? (wanted as Section) : "business"; // plan-id-ok: "business" is the Business settings tab, not the Business plan

  let members: Member[] | null = null;
  if (section === "members") {
    try {
      members = await fetchMembers(user.accessToken, tenantId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
    }
  }
  let plan: Plan | null = null;
  let usage: AiUsage | null = null;
  let profile: Part<Awaited<ReturnType<typeof getBusinessProfile>>> | null = null;
  if (section === "business") {
    try {
      [plan, usage, profile] = await Promise.all([readPlanCached(user.accessToken, tenantId).catch(rethrowAuth), admin ? readUsageCached(user.accessToken, tenantId).catch(rethrowAuth) : null, settle(() => getBusinessProfile(user.accessToken, tenantId))]);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  }
  // Agent OWL (the Owner only): the sending switches, the reminders and the scheduler's status. Each read stands on its own; one that fails says "Not available yet" in its place.
  let sending: OutboxSettings | null = null;
  let reminders: SchedulerSettings | null = null;
  let scheduler: SchedulerStatus | null = null;
  if (section === "agent") {
    try {
      [sending, reminders, scheduler] = await Promise.all([getOutboxSettings(user.accessToken, tenantId).catch(rethrowAuth), getSchedulerSettings(user.accessToken, tenantId).catch(rethrowAuth), getSchedulerStatus(user.accessToken, tenantId).catch(rethrowAuth)]);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  }
  // Data (job CC): the calendar address is every member's; the import jobs and the export's file types are the Owner's and Admin's. Each read stands alone.
  let dataParts: { formats: Part<ExportFormat[]> | null; jobs: Part<ImportJob[]> | null; feed: Part<CalendarFeed> } | null = null;
  if (section === "data") {
    try {
      const [formats, jobs, feed] = await Promise.all([admin ? settle(() => getExportFormats(user.accessToken, tenantId)) : null, admin ? settle(() => listImportJobs(user.accessToken, tenantId)) : null, settle(() => getCalendarFeed(user.accessToken, tenantId))]);
      dataParts = { formats, jobs, feed };
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  }
  // Privacy (job CC): my exports and deletions, the workspace's deletion (the Owner's) and the consent list, each read on its own.
  let privacy: { exports: Part<Awaited<ReturnType<typeof listMyExports>>>; mine: Part<Awaited<ReturnType<typeof listMyDeletions>>>; space: Part<Awaited<ReturnType<typeof listWorkspaceDeletions>>> | null; consent: Part<Awaited<ReturnType<typeof readConsentList>>> | null } | null = null;
  if (section === "privacy") {
    try {
      const [exports, mine, space, consent] = await Promise.all([
        settle(() => listMyExports(user.accessToken)),
        settle(() => listMyDeletions(user.accessToken)),
        tenant.role === "owner" ? settle(() => listWorkspaceDeletions(user.accessToken, tenantId)) : null,
        tenant.role === "viewer" ? null : settle(() => readConsentList(user.accessToken, tenantId)),
      ]);
      privacy = { exports, mine, space, consent };
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  }
  const planCtx = { token: user.accessToken, tenantId };
  const [workspacePlan, planCatalogue] = section === "plan" ? await Promise.all([readWorkspacePlan(planCtx), readCatalogue(planCtx)]) : [null, null];
  const assistant = section === "assistant" ? await readAssistant(pack?.modules ?? null) : null;
  let theme: ThemePick = "system";
  try {
    theme = readTheme((await cookies()).get(THEME_COOKIE)?.value) ?? "system";
  } catch {
    /* outside a request: follow the system */
  }
  const tabs = [
    { key: "business", label: t("settings.tab.business") },
    ...(hasPlan ? [{ key: "plan", label: t("plan.tab") }] : []),
    { key: "members", label: t("settings.tab.members") },
    ...(hasFields ? [{ key: "fields", label: t("settings.tab.fields") }] : []),
    { key: "data", label: t("settings.tab.data") },
    { key: "language", label: t("settings.tab.language") },
    ...(hasAssistant ? [{ key: "assistant", label: t("asst.tab") }] : []),
    ...(tenant.role === "owner" ? [{ key: "agent", label: t("settings.tab.agent") }] : []),
    { key: "security", label: t("settings.tab.security") },
    { key: "privacy", label: t("settings.tab.privacy") },
  ];
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("nav.item.settings")} />
      {helpTipFor(lang, base, "settings")}
      <SectionTabs label={t("settings.parts_label")} items={tabs.map((x) => ({ key: x.key, label: x.label, href: `${base}/settings?section=${x.key}`, current: x.key === section }))} />
      <div className="mt-6 max-w-3xl space-y-4">
        {section === "business" ? (
          <>
            <section className={surface} aria-label={t("settings.tab.business")}>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted">{t("settings.business.name")}</dt>
                  <dd className="font-display text-xl font-semibold">{tenant.name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">{t("settings.business.plan")}</dt>
                  <dd className="font-display text-xl font-semibold">{planText(plan, labels) ?? t("frame.notyet")}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">{t("settings.business.url")}</dt>
                  <dd className={breakAll}>{tenant.slug}</dd>
                </div>
              </dl>
            </section>
            {profile ? (
              profile.ok ? (
                <GstinForm words={wordsFor(lang, ["gst."], ["dta.btn.working"])} title={t("gst.shop.title")} intro={t("gst.shop.intro")} initial={profile.data} canEdit={admin} needsSecondStep save={saveShopGstinAction.bind(null, tenantId)} />
              ) : (
                <PartProblem kind={profile.kind} retryAfter={profile.retryAfter} words={wordsFor(lang, ["apierr.", "problem."])} title={t("gst.shop.title")} />
              )
            ) : null}
            {admin ? (
              <section className={surface} aria-labelledby="usage-heading">
                <h2 id="usage-heading" className="mb-3 text-xl font-semibold">
                  {t("frame.aiusage")}
                </h2>
                <UsageCard usage={usage} labels={labels} />
              </section>
            ) : null}
          </>
        ) : null}
        {section === "plan" ? (
          <PlanSection
            words={wordsFor(lang, ["plan."], ["frame.notyet"])}
            plan={workspacePlan}
            def={planCatalogue ? planById(workspacePlan?.planId ?? null, planCatalogue) : null}
            trialDays={planCatalogue?.trial.days ?? CATALOGUE.trial.days}
            now={clock()}
            canChange={tenant.role === "owner"}
            mock={FAKE_CHECKOUT}
            pickerHref={`${base}/plans`}
            contactEmail={ADDRESSES.billing}
            actions={{ start: startPlanAction.bind(null, tenantId), cancel: cancelPlanAction.bind(null, tenantId), fix: planScreens() === "mock" ? fixPlanPaymentAction.bind(null, tenantId) : null, endTrial: planScreens() === "mock" ? endPlanTrialAction.bind(null, tenantId) : null }}
          />
        ) : null}
        {section === "assistant" && assistant ? (
          assistant.mode === "ok" ? (
            <AssistantSettings
              words={withModuleWords(wordsFor(lang, ["asst."]), pack)}
              initial={assistant.settings}
              profile={assistantProfile(pack?.modules ?? null)}
              shop={tenant.name}
              langs={Object.fromEntries(CALL_LANGS.map((l) => [l, LANGUAGE_NAMES[l].native])) as Record<(typeof CALL_LANGS)[number], string>}
              voiceNames={Object.fromEntries(VOICES.map((v) => [v, t(`asst.voice.${v}` as "asst.voice.female_warm")])) as Record<(typeof VOICES)[number], string>}
              canEdit={tenant.role === "owner"}
              testMode={assistantScreens() === "mock"}
              saved={assistant.saved}
              actions={{ save: saveAssistantAction.bind(null, tenantId) }}
            />
          ) : (
            <section className={surface} aria-label={t("asst.tab")}>
              <p className="text-sm text-muted">{t("frame.notyet")}</p>
            </section>
          )
        ) : null}
        {section === "members" ? (
          <section className={surface} aria-label={t("settings.tab.members")}>
            <p className={mutedText}>{t("settings.members.note")}</p>
            {members === null ? (
              <p className="mt-4 text-sm text-muted">{t("frame.notyet")}</p>
            ) : (
              <ul className={listPlain}>
                {members.map((m) => (
                  <li key={m.user_id} className={memberRow}>
                    <span className="min-w-0 truncate font-medium">
                      {m.display_name ?? m.role}
                      {m.user_id === user.id ? <span className={youMark}>({t("settings.members.you")})</span> : null}
                    </span>
                    <Pill tone="neutral">{m.role}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        {section === "fields" ? (
          <FieldsSection
            fields={fieldList ?? []}
            entities={fieldEntities}
            available={fieldList !== null}
            canEdit={admin}
            notice={(["added", "updated", "unavailable", "mfa", "invalid", "role", "limit", "failed"] as const).find((n) => n === pick(query.fieldnote)) ?? null}
            lang={lang}
            add={addFieldAction.bind(null, tenantId)}
            setActive={setFieldActiveAction.bind(null, tenantId)}
            update={updateFieldAction.bind(null, tenantId)}
            t={t}
          />
        ) : null}
        {section === "data" && dataParts ? (
          <DataSection
            tenantId={tenantId}
            words={withModuleWords(wordsFor(lang, ["dta.", "apierr.", "problem.", "catalogue.stock."]), pack)}
            admin={admin}
            formats={dataParts.formats}
            jobs={dataParts.jobs}
            feed={dataParts.feed}
            makeFeed={makeCalendarFeedAction.bind(null, tenantId)}
            revokeFeed={revokeCalendarFeedAction.bind(null, tenantId)}
          />
        ) : null}
        {section === "language" ? (
          <section className={surface} aria-label={t("settings.tab.language")}>
            <h2 className={`${pageH2} mt-0`}>{t("settings.language.language")}</h2>
            <LangSelect lang={lang} label={authT(lang)("lang.label")} />
            {lang === "en" ? null : <p className={mutedText}>{t("frame.draft")}</p>}
            <h2 className={pageH2}>{t("settings.language.appearance")}</h2>
            <ThemeChoice initial={theme} label={t("settings.language.appearance")} words={{ system: t("settings.theme.system"), light: t("settings.theme.light"), dark: t("settings.theme.dark") }} />
          </section>
        ) : null}
        {section === "agent" ? (
          <div className="flex flex-col gap-5">
            {sending ? <SendingForm words={words} settings={sending} save={saveSendingAction.bind(null, tenantId)} /> : <UnreadCard note={t("frame.notyet")} />}
            {sending ? <QuietHoursForm words={words} settings={sending} reminders={reminders} save={saveQuietHoursAction.bind(null, tenantId)} /> : <UnreadCard note={t("frame.notyet")} />}
            {reminders ? <RemindersForm words={words} settings={reminders} save={saveRemindersAction.bind(null, tenantId)} /> : <UnreadCard note={t("frame.notyet")} />}
            <SystemSwitchCard words={words} settings={sending} />
            <SchedulerCard words={words} status={scheduler} now={clock()} />
          </div>
        ) : null}
        {section === "security" ? (
          <section className={`${surface} flex flex-wrap items-center gap-3`} aria-label={t("settings.tab.security")}>
            <ShieldCheck className={`size-6 shrink-0 ${user.hasSecondFactor ? "text-green-text" : "text-amber-text"}`} aria-hidden="true" />
            <p className="min-w-0 flex-1 font-medium">{user.hasSecondFactor ? t("settings.security.on") : t("settings.security.off")}</p>
            <Link href="/app/security" className={link}>
              {t("settings.security.open")}
            </Link>
          </section>
        ) : null}
        {section === "privacy" && privacy ? (
          <PrivacySection
            tenantId={tenantId}
            words={wordsFor(lang, ["prx.", "apierr.", "problem."], ["dta.btn.working", "dta.col.name", "settings.privacy.erasure", "settings.privacy.suppression", "settings.privacy.note"])}
            role={tenant.role}
            email={user.email ?? ""}
            workspaceName={tenant.name}
            exports={privacy.exports}
            myDeletions={privacy.mine}
            workspaceDeletions={privacy.space}
            consent={privacy.consent}
            now={clock()}
            actions={{
              requestExport: requestExportAction.bind(null, tenantId),
              getExport: getExportAction.bind(null, tenantId),
              openLink: exportLinkAction.bind(null, tenantId),
              requestAccountDeletion: requestAccountDeletionAction.bind(null, tenantId),
              cancelAccountDeletion: cancelAccountDeletionAction.bind(null, tenantId),
              requestWorkspaceDeletion: requestWorkspaceDeletionAction.bind(null, tenantId),
              cancelWorkspaceDeletion: cancelWorkspaceDeletionAction.bind(null, tenantId),
              executeWorkspaceDeletion: executeWorkspaceDeletionAction.bind(null, tenantId),
            }}
          />
        ) : null}
      </div>
    </main>
  );
}
