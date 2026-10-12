import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { fetchAgentCost, fetchAgentSettings, fetchRuns, RUN_ERROR_LABELS, type AgentCostOut, type AgentSettingsOut, type PageRunOut } from "@/lib/api/agents";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchPage, isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";
import {
  cancelRunAction,
  startResearchRunAction,
  startRunAction,
  toggleAgentsAction,
} from "./actions";
import { CostPanel } from "./cost-panel";
import { AgentToggleForm, CancelRunForm, StartResearchForm, StartRunForm } from "./agent-forms";
import { alertBox, bodyText, dataTable, dataTd, dataThCol, dataTr, mutedText, pageH1, pageH2, pageMain } from "@/components/v2/app/ui";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { Rich } from "@/components/v2/app/rich";
import { makeT } from "@/components/v2/app/words";
import { wordsFor, partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";

export const metadata = { title: "Agents · SME AI Revenue Engine" };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

const ADMIN_ROLES = ["owner", "admin"];
const START_ROLES = ["owner", "admin", "sales"];

/**
 * /app/tenants/[tenantId]/agents: the workspace switch, the start form and the runs. Real backend state only: every
 * row is a run the API returned, and nothing here is decorative. Server-side only; requireUser() runs FIRST and every
 * data call goes to OUR API with the user's own token. The forms are shown by role as a convenience; the API and the
 * database enforce the roles regardless.
 */
export default async function AgentsPage({ params }: PageProps<"/app/tenants/[tenantId]/agents">) {
  const lang = await getLang();
  const words = wordsFor(lang, ["ag."]);
  const t = makeT(words);
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 words={await partsWords()} />;
  }

  let settings: AgentSettingsOut | null = null;
  let runs: PageRunOut | null = null;
  let companies: { id: string; name: string }[] = [];
  let leads: { id: string; label: string }[] = [];
  let cost: AgentCostOut | null = null;
  try {
    settings = await fetchAgentSettings(user.accessToken, tenantId);
    runs = await fetchRuns(user.accessToken, tenantId);
    const page = await fetchPage(user.accessToken, tenantId, "companies");
    if (page.entity === "companies")
      companies = page.items.map((row) => ({ id: row.id, name: row.name }));
    const leadPage = await fetchPage(user.accessToken, tenantId, "leads");
    if (leadPage.entity === "leads") {
      const names = new Map(companies.map((c) => [c.id, c.name]));
      // a lead with no company has nothing to research: it is not offered
      leads = leadPage.items
        .filter((row) => row.company_id !== null && names.has(row.company_id))
        .map((row) => ({ id: row.id, label: names.get(row.company_id as string) ?? t("ag.lead_fallback") }));
    }
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the sections below show an error, never placeholder data
  }

  const canManage = ADMIN_ROLES.includes(tenant.role);
  if (canManage) {
    try {
      cost = await fetchAgentCost(user.accessToken, tenantId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      // anything else: the panel says so, never placeholder numbers
    }
  }
  const canStart = START_ROLES.includes(tenant.role);

  return (
    <main className={pageMain} lang={lang}>
      <h1 className={pageH1}>{t("ag.agents")}</h1>
      <p className={mutedText}>
        {t("ag.an_agent_only_suggests_everything_it")}
      </p>

      <section aria-labelledby="switch-heading">
        <h2 id="switch-heading" className={pageH2}>{t("ag.this_workspace")}</h2>
        {settings === null ? (
          <p role="alert" className={alertBox}>
            {t("ag.could_not_load_the_agent_settings")}
          </p>
        ) : (
          <>
            <p className={bodyText}>
              <Rich t={t} k="ag.agents_on_line" with={{ state: <strong>{settings.enabled ? t("ag.state_on") : t("ag.state_off")}</strong> }} />
            </p>
            {canManage ? (
              <AgentToggleForm words={words}
                action={toggleAgentsAction.bind(null, tenantId)}
                enabled={settings.enabled}
              />
            ) : (
              <p className={mutedText}>{t("ag.only_an_owner_or_admin_can")}</p>
            )}
          </>
        )}
      </section>

      {canStart && settings?.enabled && (
        <section aria-labelledby="start-heading">
          <h2 id="start-heading" className={pageH2}>{t("ag.start_a_run")}</h2>
          <p className={mutedText}>
            {t("ag.the_selftest_agent_reads_a_company")}
          </p>
          <StartRunForm words={words}
            action={startRunAction.bind(null, tenantId)}
            runId={crypto.randomUUID()}
            companies={companies}
          />
        </section>
      )}

      {canStart && settings?.enabled && leads.length > 0 && (
        <section aria-labelledby="research-heading">
          <h2 id="research-heading" className={pageH2}>{t("ag.research_a_lead")}</h2>
          <p className={mutedText}>
            {t("ag.the_research_agent_reads_only_the")}
          </p>
          <StartResearchForm words={words}
            action={startResearchRunAction.bind(null, tenantId)}
            runId={crypto.randomUUID()}
            leads={leads}
          />
        </section>
      )}

      {canManage && <CostPanel words={words} cost={cost} />}

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className={pageH2}>{t("ag.runs")}</h2>
        {runs === null ? (
          <p role="alert" className={alertBox}>
            {t("ag.could_not_load_the_runs_from")}
          </p>
        ) : runs.items.length === 0 ? (
          <p className={bodyText}>{t("ag.no_runs_yet")}</p>
        ) : (
          <table className={`mt-4 ${dataTable}`}>
            <thead>
              <tr>
                <th className={dataThCol}>{t("ag.started")}</th>
                <th className={dataThCol}>{t("ag.agent")}</th>
                <th className={dataThCol}>{t("ag.target")}</th>
                <th className={dataThCol}>{t("ag.status")}</th>
                <th className={dataThCol}>{t("ag.writes")}</th>
                <th className={dataThCol}>{t("ag.started_by")}</th>
                <th className={dataThCol} />
              </tr>
            </thead>
            <tbody>
              {runs.items.map((run) => (
                <tr key={run.id} className={dataTr}>
                  <td data-label={t("ag.col_started")} className={dataTd}>
                    <LocalTime iso={run.created_at} />
                  </td>
                  <td data-label={t("ag.col_agent")} className={dataTd}>{run.agent_name}</td>
                  <td data-label={t("ag.col_target")} className={dataTd}>
                    {run.company_id ? (
                      <Link href={`/app/tenants/${tenantId}/companies/${run.company_id}`}>{t("ag.company")}</Link>
                    ) : run.lead_id ? (
                      <Link href={`/app/tenants/${tenantId}/leads/${run.lead_id}`}>{t("ag.lead")}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label={t("ag.col_status")} className={dataTd}>
                    {t(`ag.run.${run.status}`)}
                    {run.status === "failed" && run.error_code ? `: ${RUN_ERROR_LABELS[run.error_code]}` : ""}
                  </td>
                  <td data-label={t("ag.col_writes")} className={dataTd}>
                    {run.writes_used}/{run.max_writes}
                  </td>
                  <td data-label={t("ag.col_started_by")} className={dataTd}>{run.started_by === user.id ? "you" : t("ag.a_teammate")}</td>
                  <td data-label="" className={dataTd}>
                    {run.status === "running" && (canManage || run.started_by === user.id) && (
                      <CancelRunForm words={words} action={cancelRunAction.bind(null, tenantId, run.id)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

