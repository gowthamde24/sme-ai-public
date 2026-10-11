import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";

import { LangSelect } from "@/components/v2/controls/LangSelect";
import { ThemeChoice, type ThemePick } from "@/components/v2/controls/ThemeChoice";
import { UsageCard, planText } from "@/components/v2/app/frame-parts";
import { ApiDownV2, PageTop, Pill, SectionTabs } from "@/components/v2/app/parts";
import { breakAll, link, listPlain, memberRow, youMark, mutedText, pageH2, pageMain, surface } from "@/components/v2/app/ui";
import { appT, frameLabels } from "@/i18n/app";
import { authT } from "@/i18n/auth";
import { getLang } from "@/i18n/get-lang";
import { THEME_COOKIE, readTheme } from "@/i18n/preferences";
import { SchedulerCard, SystemSwitchCard } from "@/components/v2/app/agent-settings/AgentStatusCards";
import { QuietHoursForm, RemindersForm, SendingForm } from "@/components/v2/app/agent-settings/AgentSettingsForms";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { getOutboxSettings, type OutboxSettings } from "@/lib/api/outbox";
import { getSchedulerSettings, getSchedulerStatus, type SchedulerSettings, type SchedulerStatus } from "@/lib/api/scheduler";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchMembers, type Member } from "@/lib/api/orders";
import { getPlan, type Plan } from "@/lib/api/plan";
import { getAiUsage, type AiUsage } from "@/lib/api/ai-usage";
import { requireUser } from "@/lib/auth/session";

import { saveQuietHoursAction, saveRemindersAction, saveSendingAction } from "./agent-settings-actions";
import { agentWords } from "./agent-words";

export const metadata = { title: "Settings · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const SECTIONS = ["business", "members", "language", "agent", "security", "privacy"] as const;
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
    return <ApiDownV2 />;
  }
  const lang = await getLang();
  const t = appT(lang);
  const labels = frameLabels(lang);
  const wanted = pick(query.section);
  const section: Section = (SECTIONS as readonly string[]).includes(wanted ?? "") && !(wanted === "agent" && tenant.role !== "owner") ? (wanted as Section) : "business";
  const base = `/app/tenants/${tenantId}`;
  const words = agentWords(lang);
  const admin = tenant.role === "owner" || tenant.role === "admin";

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
  if (section === "business") {
    [plan, usage] = await Promise.all([getPlan(user.accessToken, tenantId).catch(() => null), admin ? getAiUsage(user.accessToken, tenantId).catch(() => null) : null]);
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
      throw error;
    }
  }
  let theme: ThemePick = "system";
  try {
    theme = readTheme((await cookies()).get(THEME_COOKIE)?.value) ?? "system";
  } catch {
    /* outside a request: follow the system */
  }
  const tabs = [
    { key: "business", label: t("settings.tab.business") },
    { key: "members", label: t("settings.tab.members") },
    { key: "language", label: t("settings.tab.language") },
    ...(tenant.role === "owner" ? [{ key: "agent", label: t("settings.tab.agent") }] : []),
    { key: "security", label: t("settings.tab.security") },
    { key: "privacy", label: t("settings.tab.privacy") },
  ];
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={t("nav.item.settings")} />
      <SectionTabs label="Parts of Settings" items={tabs.map((x) => ({ key: x.key, label: x.label, href: `${base}/settings?section=${x.key}`, current: x.key === section }))} />
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
        {section === "privacy" ? (
          <section className={surface} aria-label={t("settings.tab.privacy")}>
            <ul className={listPlain}>
              {admin ? (
                <li>
                  <Link href={`${base}/privacy`} className={link}>
                    {t("settings.privacy.erasure")}
                  </Link>
                </li>
              ) : null}
              {tenant.role === "owner" ? (
                <li>
                  <Link href={`${base}/suppression`} className={link}>
                    {t("settings.privacy.suppression")}
                  </Link>
                </li>
              ) : null}
            </ul>
            {tenant.role === "owner" ? null : <p className={mutedText}>{t("settings.privacy.note")}</p>}
          </section>
        ) : null}
      </div>
    </main>
  );
}
