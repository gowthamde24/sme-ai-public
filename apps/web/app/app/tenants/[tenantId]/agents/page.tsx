import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  fetchAgentSettings,
  fetchRuns,
  RUN_ERROR_LABELS,
  RUN_STATUS_LABELS,
  type AgentSettingsOut,
  type PageRunOut,
} from "@/lib/api/agents";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { fetchPage, isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { LocalTime } from "../../../local-time";
import { cancelRunAction, startRunAction, toggleAgentsAction } from "./actions";
import { AgentToggleForm, CancelRunForm, StartRunForm } from "./agent-forms";

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
    return <ApiDown />;
  }

  let settings: AgentSettingsOut | null = null;
  let runs: PageRunOut | null = null;
  let companies: { id: string; name: string }[] = [];
  try {
    settings = await fetchAgentSettings(user.accessToken, tenantId);
    runs = await fetchRuns(user.accessToken, tenantId);
    const page = await fetchPage(user.accessToken, tenantId, "companies");
    if (page.entity === "companies")
      companies = page.items.map((row) => ({ id: row.id, name: row.name }));
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    // anything else: the sections below show an error, never placeholder data
  }

  const canManage = ADMIN_ROLES.includes(tenant.role);
  const canStart = START_ROLES.includes(tenant.role);

  return (
    <main className="shell wide">
      <p>
        <Link href={`/app/tenants/${tenantId}`}>← {tenant.name}</Link>
      </p>
      <h1>Agents</h1>
      <p>
        Your role: <strong>{tenant.role}</strong>
      </p>
      <p className="hint">
        An agent only suggests. Everything it writes is marked &quot;agent suggestion, unreviewed&quot; until an owner or admin
        accepts it, and nothing it writes changes a score before that.
      </p>

      <section aria-labelledby="switch-heading">
        <h2 id="switch-heading">This workspace</h2>
        {settings === null ? (
          <p role="alert" className="error">
            Could not load the agent settings from the API. Try again shortly.
          </p>
        ) : (
          <>
            <p>
              Agents are <strong>{settings.enabled ? "on" : "off"}</strong> for this workspace.
            </p>
            {canManage ? (
              <AgentToggleForm
                action={toggleAgentsAction.bind(null, tenantId)}
                enabled={settings.enabled}
              />
            ) : (
              <p className="hint">Only an owner or admin can change this.</p>
            )}
          </>
        )}
      </section>

      {canStart && settings?.enabled && (
        <section aria-labelledby="start-heading">
          <h2 id="start-heading">Start a run</h2>
          <p className="hint">
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

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading">Runs</h2>
        {runs === null ? (
          <p role="alert" className="error">
            Could not load the runs from the API. Try again shortly.
          </p>
        ) : runs.items.length === 0 ? (
          <p>No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Agent</th>
                <th>Target</th>
                <th>Status</th>
                <th>Writes</th>
                <th>Started by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.items.map((run) => (
                <tr key={run.id}>
                  <td>
                    <LocalTime iso={run.created_at} />
                  </td>
                  <td>{run.agent_name}</td>
                  <td>
                    {run.company_id ? (
                      <Link href={`/app/tenants/${tenantId}/companies/${run.company_id}`}>Company</Link>
                    ) : run.lead_id ? (
                      <Link href={`/app/tenants/${tenantId}/leads/${run.lead_id}`}>Lead</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {RUN_STATUS_LABELS[run.status]}
                    {run.status === "failed" && run.error_code ? `: ${RUN_ERROR_LABELS[run.error_code]}` : ""}
                  </td>
                  <td>
                    {run.writes_used}/{run.max_writes}
                  </td>
                  <td>{run.started_by === user.id ? "you" : "a teammate"}</td>
                  <td>
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

function ApiDown() {
  return (
    <main className="shell wide">
      <p role="alert" className="error">
        Could not load this from the API. Try again shortly.
      </p>
      <p>
        <Link href="/app">Back to your workspaces</Link>
      </p>
    </main>
  );
}
