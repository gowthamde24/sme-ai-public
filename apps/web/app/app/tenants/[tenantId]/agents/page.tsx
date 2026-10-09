import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  fetchAgentCost,
  fetchAgentSettings,
  fetchRuns,
  RUN_ERROR_LABELS,
  RUN_STATUS_LABELS,
  type AgentCostOut,
  type AgentSettingsOut,
  type PageRunOut,
} from "@/lib/api/agents";
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
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();

  let tenant;
  try {
    tenant = await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    return <ApiDownV2 />;
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
        .map((row) => ({ id: row.id, label: names.get(row.company_id as string) ?? "Lead" }));
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
    <main className={pageMain}>
      <h1 className={pageH1}>Agents</h1>
      <p className={mutedText}>
        An agent only suggests. Everything it writes is marked &quot;agent suggestion, unreviewed&quot; until an owner or admin
        accepts it, and nothing it writes changes a score before that.
      </p>

      <section aria-labelledby="switch-heading">
        <h2 id="switch-heading" className={pageH2}>This workspace</h2>
        {settings === null ? (
          <p role="alert" className={alertBox}>
            Could not load the agent settings from the API. Try again shortly.
          </p>
        ) : (
          <>
            <p className={bodyText}>
              Agents are <strong>{settings.enabled ? "on" : "off"}</strong> for this workspace.
            </p>
            {canManage ? (
              <AgentToggleForm
                action={toggleAgentsAction.bind(null, tenantId)}
                enabled={settings.enabled}
              />
            ) : (
              <p className={mutedText}>Only an owner or admin can change this.</p>
            )}
          </>
        )}
      </section>

      {canStart && settings?.enabled && (
        <section aria-labelledby="start-heading">
          <h2 id="start-heading" className={pageH2}>Start a run</h2>
          <p className={mutedText}>
            The selftest agent reads a company&apos;s name, city, region and website host, and writes one note and a few
            observations. It does no research and contacts no one.
          </p>
          <StartRunForm
            action={startRunAction.bind(null, tenantId)}
            runId={crypto.randomUUID()}
            companies={companies}
          />
        </section>
      )}

      {canStart && settings?.enabled && leads.length > 0 && (
        <section aria-labelledby="research-heading">
          <h2 id="research-heading" className={pageH2}>Research a lead</h2>
          <p className={mutedText}>
            The research agent reads only the lead&apos;s company&apos;s own website, quotes what it finds, and suggests what it
            says about the buyer type, order size, size and whether the business is open. Every suggestion stays
            &quot;agent suggestion, unreviewed&quot; until an owner or admin accepts it. It contacts no one. (Development: it
            runs on synthetic demo sites only.)
          </p>
          <StartResearchForm
            action={startResearchRunAction.bind(null, tenantId)}
            runId={crypto.randomUUID()}
            leads={leads}
          />
        </section>
      )}

      {canManage && <CostPanel cost={cost} />}

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className={pageH2}>Runs</h2>
        {runs === null ? (
          <p role="alert" className={alertBox}>
            Could not load the runs from the API. Try again shortly.
          </p>
        ) : runs.items.length === 0 ? (
          <p className={bodyText}>No runs yet.</p>
        ) : (
          <table className={`mt-4 ${dataTable}`}>
            <thead>
              <tr>
                <th className={dataThCol}>Started</th>
                <th className={dataThCol}>Agent</th>
                <th className={dataThCol}>Target</th>
                <th className={dataThCol}>Status</th>
                <th className={dataThCol}>Writes</th>
                <th className={dataThCol}>Started by</th>
                <th className={dataThCol} />
              </tr>
            </thead>
            <tbody>
              {runs.items.map((run) => (
                <tr key={run.id} className={dataTr}>
                  <td data-label="Started" className={dataTd}>
                    <LocalTime iso={run.created_at} />
                  </td>
                  <td data-label="Agent" className={dataTd}>{run.agent_name}</td>
                  <td data-label="Target" className={dataTd}>
                    {run.company_id ? (
                      <Link href={`/app/tenants/${tenantId}/companies/${run.company_id}`}>Company</Link>
                    ) : run.lead_id ? (
                      <Link href={`/app/tenants/${tenantId}/leads/${run.lead_id}`}>Lead</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Status" className={dataTd}>
                    {RUN_STATUS_LABELS[run.status]}
                    {run.status === "failed" && run.error_code ? `: ${RUN_ERROR_LABELS[run.error_code]}` : ""}
                  </td>
                  <td data-label="Writes" className={dataTd}>
                    {run.writes_used}/{run.max_writes}
                  </td>
                  <td data-label="Started by" className={dataTd}>{run.started_by === user.id ? "you" : "a teammate"}</td>
                  <td data-label="" className={dataTd}>
                    {run.status === "running" && (canManage || run.started_by === user.id) && (
                      <CancelRunForm action={cancelRunAction.bind(null, tenantId, run.id)} />
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

