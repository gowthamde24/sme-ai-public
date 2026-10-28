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
import { GstinForm, QuietHoursForm, RemindersForm, SendingForm } from "@/components/v2/app/settings/LazyTabs";
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
import { AssistantSettings } from "@/components/v2/app/assistant/LazyAssistantSettings";
import { CallSettingsAdvanced } from "@/components/v2/app/assistant/LazyCallSettingsAdvanced";
import { OwnVoice } from "@/components/v2/app/assistant/LazyOwnVoice";
import { assistantProfile } from "@/lib/assistant/defaults";
import { readAssistant } from "@/lib/assistant/source";
import { CALL_LANG_NAMES, VOICES } from "@/lib/assistant/types";
import { readCallSettings } from "@/lib/call-settings/source";
import { readOwnVoice } from "@/lib/own-voice/source";
import { aboutBusinessScreens, assistantScreens, callSettingsScreens, dpdpScreens, openingLineScreens, ownVoiceScreens, topupScreens, voicePickerScreens, voiceSampleScreens } from "@/lib/screens/flag";
import { OpeningLine } from "@/components/v2/app/assistant/LazyOpeningLine";
import { AboutBusiness } from "@/components/v2/app/assistant/LazyAboutBusiness";
import { apiFor } from "@/lib/context/server";
import { VoicePicker } from "@/components/v2/app/assistant/LazyVoicePicker";
import { readVoicePicker } from "@/lib/voice-picker/source";
import { inForce, PICKER_LANGS, type PickerLang } from "@/lib/voice-picker/types";
import { withNamedAssistant } from "@/lib/assistant/default-name";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";
import { chooseVoiceAction } from "../voice-picker-actions";
import { readOpeningLine } from "@/lib/opening-line/source";
import { currentAssistantName } from "@/lib/assistant/name";
import { previewOpeningLineAction, saveOpeningLineAction } from "../opening-line-actions";
import { readConsents } from "@/lib/dpdp/source";
import { RESPONSE_DAYS } from "@/lib/site/business";
import { grievanceAction, setMarketingAction } from "../dpdp-actions";
import { saveAssistantAction, testCallAction } from "../assistant-actions";
import { saveCallSettingsAction } from "../call-settings-actions";
import { deleteVoiceAction, sentenceAction } from "../own-voice-actions";
import { FAKE_CHECKOUT, planScreens } from "@/lib/plan/flag";
import { CATALOGUE, planById } from "@/lib/plan/catalogue";
import { readCatalogue, readWorkspacePlan } from "@/lib/plan/source";
import { cancelPlanAction, endPlanTrialAction, fixPlanPaymentAction, startPlanAction } from "../plan-actions";
import { topupsPart } from "./topups-part";
import { BusinessForm, BusinessLogo } from "@/components/v2/app/settings/BusinessForm";
import { getWorkspaceProfile, type WorkspaceProfile } from "@/lib/api/workspace";
import { readTypeList } from "@/lib/packs/type-list";
import { getProfile, PROFILE_LANGUAGES, type BusinessProfile } from "@/lib/api/profile";
import { logoAction, saveBusinessAction } from "./business-actions";
import { ActivationCard } from "@/components/v2/app/start/ActivationCard";
import { readActivation, type Activation } from "@/lib/packs/activation";
import { leadDeskSteps } from "@/lib/packs/lead-activation";
import { readHidden } from "@/lib/packs/hidden-steps";
import { setStepHiddenAction } from "../start-hide-actions";
import { pictureAction, saveMyProfileAction } from "./profile-actions";
import { MyProfile } from "@/components/v2/app/settings/MyProfile";
import { Avatar } from "@/components/v2/app/Avatar";
import { lettersOf } from "@/components/v2/app/letters";
import { getMyProfile, getPeople, type MyProfile as MyProfileData, type Person } from "@/lib/api/me";
import { signOutEverywhereAction } from "../../../actions";

export const metadata = { title: `Settings · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const SECTIONS = ["business", "profile", "plan", "members", "fields", "data", "language", "assistant", "agent", "security", "privacy"] as const; // plan-id-ok: "business" is the Business settings tab, not the Business plan
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
  // the business name, city and languages are editable by the people who run the business (read here; a failed read leaves the plain name)
  const onBusiness = wanted === undefined || wanted === "business";
  const workspace: WorkspaceProfile | null = admin && onBusiness ? await getWorkspaceProfile(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const businessProfile: BusinessProfile | null = workspace ? { name: workspace.name, town: workspace.city, languages: workspace.languages.filter((l) => (PROFILE_LANGUAGES as readonly string[]).includes(l)), setupComplete: true } : admin && onBusiness ? await getProfile(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const typeList = workspace && tenant.role === "owner" ? await readTypeList(lang) : null;
  // the steps still to do of "Finish setting up", all of them (the ones put away from Today are marked, with the way back)
  const finish: Activation | null = admin && onBusiness && pack && usesChecklist(pack) ? await readActivation(user.accessToken, tenantId, pack, t, await leadDeskSteps(pack)).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const putAway = finish ? await readHidden(tenantId) : [];
  const hasFields = admin && fieldEntities.length > 0 && (usesChecklist(pack) || (fieldList !== null && fieldList.length > 0));
  // the Plan part (job DK): only while the feature flag is on, and only for the people who run the business
  const hasPlan = admin && (planScreens() !== "off" || topupScreens() !== "off");
  // Settings > AI assistant (job DM): only while its flag is on, and only for the Owner (the people who run the business may be admins, but the assistant is the Owner's to set up)
  const hasAssistant = tenant.role === "owner" && (assistantScreens() !== "off" || ownVoiceScreens() !== "off" || callSettingsScreens() !== "off" || openingLineScreens() !== "off" || voicePickerScreens() !== "off" || aboutBusinessScreens() !== "off");
  const section: Section = (SECTIONS as readonly string[]).includes(wanted ?? "") && !(wanted === "agent" && tenant.role !== "owner") && !(wanted === "fields" && !hasFields) && !(wanted === "plan" && !hasPlan) && !(wanted === "assistant" && !hasAssistant) ? (wanted as Section) : "business"; // plan-id-ok: "business" is the Business settings tab, not the Business plan

  let members: Member[] | null = null;
  let people: Person[] = [];
  if (section === "members") {
    try {
      members = await fetchMembers(user.accessToken, tenantId);
      people = await getPeople(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : []));
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
    }
  }
  // Settings > My profile: the person's own name, language and picture (any member)
  let mine: MyProfileData | null = null;
  if (section === "profile") mine = await getMyProfile(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null));
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
  let dpdp: { consents: Awaited<ReturnType<typeof readConsents>> } | null = null;
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
      if (dpdpScreens() !== "off") dpdp = { consents: await readConsents(user.accessToken) };
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      escalate(error);
      throw error;
    }
  }
  const planCtx = { token: user.accessToken, tenantId };
  const [workspacePlan, planCatalogue] = section === "plan" ? await Promise.all([readWorkspacePlan(planCtx), readCatalogue(planCtx)]) : [null, null];
  const topups = section === "plan" ? await topupsPart({ token: user.accessToken, tenantId, lang, owner: tenant.role === "owner", plan: workspacePlan, catalogue: planCatalogue }) : null;
  const assistant = section === "assistant" ? await readAssistant({ token: user.accessToken, tenantId }, pack?.modules ?? null) : null;
  // under the assistant (job DP): its own voice, with consent, and the advanced call settings; each behind its own flag, the Owner only
  const assistantCtx = { token: user.accessToken, tenantId };
  const ownVoice = section === "assistant" && ownVoiceScreens() !== "off" ? await readOwnVoice(assistantCtx) : null;
  // "About my business": the notes the assistant reads (read here once; the screen then saves through its own route)
  const aboutApi = section === "assistant" ? apiFor(aboutBusinessScreens(), user.accessToken, tenantId) : null;
  const about = aboutApi ? await aboutApi.get().catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const openingLine = section === "assistant" && openingLineScreens() !== "off" ? await readOpeningLine(assistantCtx) : null;
  // the voice picker (owner decision 28 Oct): one block per language the business talks in (its own languages and the assistant's main one, else the one in use) that the catalogue has a row for
  const voicePicker = section === "assistant" && voicePickerScreens() !== "off" ? await readVoicePicker(assistantCtx) : null;
  const pickerLangs: PickerLang[] = section === "assistant" && voicePicker?.mode === "ok" ? await getWorkspaceProfile(user.accessToken, tenantId).then((p) => p.languages, (e) => (e instanceof ApiAuthError ? redirect("/login") : [] as string[])).then((own) => PICKER_LANGS.filter((l) => [...own, ...(assistant?.mode === "ok" ? [assistant.settings.lang] : own.length === 0 ? [lang] : [])].includes(l))) : [];
  const callSettings = section === "assistant" && callSettingsScreens() !== "off" ? await readCallSettings(assistantCtx, pack?.modules ?? null) : null;
  let theme: ThemePick = "system";
  try {
    theme = readTheme((await cookies()).get(THEME_COOKIE)?.value) ?? "system";
  } catch {
    /* outside a request: follow the system */
  }
  const tabs = [
    { key: "business", label: t("settings.tab.business") },
    { key: "profile", label: t("settings.tab.profile") },
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
            {businessProfile ? (
              <section className={surface} aria-label={t("settings.biz.title")}>
                <BusinessForm
                  action={saveBusinessAction.bind(null, tenantId)}
                  words={wordsFor(lang, ["settings.biz."])}
                  name={businessProfile.name}
                  town={businessProfile.town ?? ""}
                  languages={businessProfile.languages.length > 0 ? businessProfile.languages : [lang]}
                  choices={PROFILE_LANGUAGES}
                  usedIn={workspace?.nameUsedIn ?? []}
                  owner={workspace && typeList && typeList.groups.length > 0 ? { groups: typeList.groups, typeWords: typeList.words, otherId: typeList.otherId, type: workspace.type, typeLabel: workspace.typeLabel ?? "", phone: workspace.phone ?? "" } : null}
                />
                {workspace ? <BusinessLogo action={logoAction.bind(null, tenantId)} words={wordsFor(lang, ["settings.biz.logo."])} logoUrl={workspace.logoUrl} initial={businessProfile.name.slice(0, 1).toUpperCase()} /> : null}
              </section>
            ) : null}
            {finish && finish.done < finish.total ? <ActivationCard activation={finish} base={base} t={t} hide={setStepHiddenAction.bind(null, tenantId)} hidden={putAway} /> : null}
            <section className={surface} aria-label={t("settings.tab.business")}>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {businessProfile ? null : (
                <div>
                  <dt className="text-sm text-muted">{t("settings.business.name")}</dt>
                  <dd className="font-display text-xl font-semibold">{tenant.name}</dd>
                </div>
                )}
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
        {section === "profile" ? (
          <section className={surface} aria-label={t("settings.tab.profile")}>
            {mine ? (
              <MyProfile
                words={wordsFor(lang, ["settings.me."])}
                name={mine.displayName ?? ""}
                language={mine.language ?? lang}
                choices={PROFILE_LANGUAGES}
                pictureUrl={mine.pictureUrl}
                own={mine.picture === "own"}
                email={user.email}
                save={saveMyProfileAction.bind(null, tenantId)}
                picture={pictureAction.bind(null, tenantId)}
              />
            ) : (
              <p className="text-sm text-muted">{t("frame.notyet")}</p>
            )}
          </section>
        ) : null}
        {section === "plan" && planScreens() !== "off" ? (
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
            usageBars={topupScreens() === "off"}
            actions={{ start: startPlanAction.bind(null, tenantId), cancel: cancelPlanAction.bind(null, tenantId), fix: planScreens() === "mock" ? fixPlanPaymentAction.bind(null, tenantId) : null, endTrial: planScreens() === "mock" ? endPlanTrialAction.bind(null, tenantId) : null }}
          />
        ) : null}
        {topups}
        {section === "assistant" && assistant ? (
          <>
            {assistant.mode === "unavailable" ? (
              <section className={surface} aria-label={t("asst.tab")}>
                <p className="text-sm text-muted">{t("frame.notyet")}</p>
              </section>
            ) : null}
            {assistant.mode === "ok" ? (
            <AssistantSettings
              words={withModuleWords(wordsFor(lang, ["asst."]), pack)}
              initial={assistant.settings}
              profile={assistantProfile(pack?.modules ?? null)}
              shop={tenant.name}
              langs={CALL_LANG_NAMES}
              voiceNames={Object.fromEntries(VOICES.map((v) => [v, t(`asst.voice.${v}` as "asst.voice.female_warm")])) as Record<(typeof VOICES)[number], string>}
              canEdit={tenant.role === "owner"}
              testMode={assistantScreens() === "mock"}
              saved={assistant.saved}
              actions={{ save: saveAssistantAction.bind(null, tenantId), testCall: testCallAction.bind(null, tenantId) }}
              samples={voiceSampleScreens() !== "off" ? { endpoint: `/app/tenants/${tenantId}/voice-sample`, mock: voiceSampleScreens() === "mock" } : null}
              ownVoiceReady={ownVoice?.mode === "ok" && ownVoice.voice.status === "ready"}
              voicePickerOn={voicePicker?.mode === "ok"}
              voiceInUse={voicePicker?.mode === "ok" && assistant?.mode === "ok" ? ((v) => (v ? { name: v.name, label: v.label } : null))(inForce(voicePicker.data, assistant.settings.lang as PickerLang)) : null}
              defaultName={withNamedAssistant("{assistant}", DEFAULT_ASSISTANT_NAME, lang)}
            />
            ) : null}
            {about?.ok ? (
              <AboutBusiness
                words={wordsFor(lang, ["ctx."])}
                initial={about.data}
                endpoint={`${base}/context`}
                canEdit={tenant.role === "owner" || tenant.role === "admin"}
                lang={lang}
                sourcesHref={`${base}/lead-sources`}
              />
            ) : null}
            {openingLine?.mode === "ok" ? (
              <OpeningLine
                words={wordsFor(lang, ["ope."])}
                langNames={CALL_LANG_NAMES}
                scope={{ kind: "workspace" }}
                lines={openingLine.data.lines}
                fallback={openingLine.data.defaults}
                mentionAi={openingLine.data.mentionAi}
                effectiveAi={openingLine.data.mentionAi}
                names={{ assistant: assistant?.mode === "ok" ? assistant.settings.name : currentAssistantName(), business: tenant.name }}
                canEdit={tenant.role === "owner"}
                mock={openingLineScreens() === "mock"}
                actions={{ save: saveOpeningLineAction.bind(null, tenantId), preview: previewOpeningLineAction.bind(null, tenantId) }}
              />
            ) : null}
            {voicePicker?.mode === "ok" ? (
              <VoicePicker
                words={wordsFor(lang, ["vp."])}
                rows={pickerLangs.map((l) => ({ language: l, voices: voicePicker.data.voices.filter((v) => v.language === l), choice: voicePicker.data.choices[l] ?? null }))}
                langNames={CALL_LANG_NAMES}
                canEdit={admin}
                endpoint={`${base}/voice-pick`}
                mock={voicePickerScreens() === "mock"}
                actions={{ choose: chooseVoiceAction.bind(null, tenantId) }}
              />
            ) : null}
            {ownVoice?.mode === "ok" ? (
              <OwnVoice
                words={wordsFor(lang, ["ov."], ["today.err.mfa", "today.err.mfa.link"])}
                voice={ownVoice.voice}
                canEdit={tenant.role === "owner"}
                endpoint={`${base}/own-voice`}
                actions={{ sentence: sentenceAction.bind(null, tenantId), remove: deleteVoiceAction.bind(null, tenantId) }}
              />
            ) : null}
            {callSettings?.mode === "ok" ? (
              <CallSettingsAdvanced
                words={wordsFor(lang, ["calls."], ["asst.hours.from", "asst.hours.to", "asst.hours.t", ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `asst.day.${d}`), "today.err.mfa", "today.err.mfa.link"])}
                initial={callSettings.settings}
                locked={callSettings.lockedPurposes}
                canEdit={tenant.role === "owner"}
                mock={callSettingsScreens() === "mock"}
                saved={callSettings.saved}
                actions={{ save: saveCallSettingsAction.bind(null, tenantId) }}
              />
            ) : null}
            {ownVoice?.mode === "unavailable" || callSettings?.mode === "unavailable" || openingLine?.mode === "unavailable" || (about && !about.ok) ? (
              <section className={surface}>
                <p className="text-sm text-muted">{t("frame.notyet")}</p>
              </section>
            ) : null}
          </>
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
                    <span className="flex min-w-0 items-center gap-3 truncate font-medium">
                      <Avatar url={people.find((p) => p.userId === m.user_id)?.pictureUrl ?? null} letters={lettersOf(m.display_name, null)} className="grid size-9 shrink-0 place-items-center rounded-full bg-charcoal text-sm font-semibold text-on-charcoal" />
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
          <section className={`${surface} flex flex-col gap-3`} aria-label={t("settings.security.title")}>
            <h2 className="text-xl font-semibold">{t("settings.security.title")}</h2>
            <p className="text-base text-muted">{t("settings.security.why")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <ShieldCheck className={`size-6 shrink-0 ${user.hasSecondFactor ? "text-green-text" : "text-muted"}`} aria-hidden="true" />
              <p className="min-w-0 flex-1 font-medium">{user.hasSecondFactor ? t("settings.security.on") : t("settings.security.off")}</p>
              <Link href="/app/security" className={link}>
                {user.hasSecondFactor ? t("settings.security.manage") : t("settings.security.turnon")}
              </Link>
            </div>
          </section>
        ) : null}
        {section === "security" ? (
          <section className={`${surface} flex flex-col gap-3`} aria-label={t("settings.security.all.t")} data-part="signout-all">
            <h2 className="text-xl font-semibold">{t("settings.security.all.t")}</h2>
            <p className="text-base text-muted">{t("settings.security.all.d")}</p>
            {pick(query.signout) === "failed" ? (
              <p role="alert" className="rounded-lg border border-red-text bg-red-bg px-3 py-2 text-sm font-medium text-red-text">
                {t("settings.security.all.failed")}
              </p>
            ) : null}
            <form action={signOutEverywhereAction}>
              <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-full border border-red-text bg-red-bg px-[18px] text-[15px] font-semibold text-red-text hover:brightness-95">
                {t("settings.security.all.btn")}
              </button>
            </form>
          </section>
        ) : null}
        {section === "privacy" && privacy ? (
          <PrivacySection
            tenantId={tenantId}
            words={wordsFor(lang, ["prx.", "apierr.", "problem.", "dpdp."], ["dta.btn.working", "dta.col.name", "settings.privacy.erasure", "settings.privacy.suppression", "settings.privacy.note"])}
            role={tenant.role}
            email={user.email ?? ""}
            workspaceName={tenant.name}
            exports={privacy.exports}
            myDeletions={privacy.mine}
            workspaceDeletions={privacy.space}
            consent={privacy.consent}
            now={clock()}
            lang={lang}
            dpdp={dpdp ? { consents: dpdp.consents, setMarketing: setMarketingAction.bind(null, tenantId), grievance: grievanceAction.bind(null, tenantId), days: RESPONSE_DAYS.grievances, privacyEmail: ADDRESSES.privacy, name: user.displayName ?? "" } : null}
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
