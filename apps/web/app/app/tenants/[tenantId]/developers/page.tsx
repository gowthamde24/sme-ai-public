import { notFound, redirect } from "next/navigation";

import { ActivityTab } from "@/components/v2/app/developers/ActivityTab";
import { DevelopersView, TABS, type Tab } from "@/components/v2/app/developers/DevelopersView";
import { WebhooksTab } from "@/components/v2/app/developers/WebhooksTab";
import { DeveloperKeysCard } from "@/components/v2/app/settings/LazyDeveloperKeys";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { getActivityUsage, listActivity, listEndpoints, listEvents } from "@/lib/api/webhooks-out";
import { readDeveloper } from "@/lib/developer/source";
import { isLang } from "@/lib/developer/overview";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";

import { createKeyAction, revokeKeyAction, rotateKeyAction } from "../settings/developer-actions";
import { activityAction, changeHookAction, createHookAction, deleteHookAction, deliveriesAction, rotateHookAction, testHookAction } from "./webhooks-actions";

export const metadata = { title: `Developers · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const isTab = (v: unknown): v is Tab => typeof v === "string" && (TABS as readonly string[]).includes(v);

/** /app/tenants/[tenantId]/developers (Owner and Admin): Overview, API keys (the existing test-key card) and the tabs C1's developer API has not opened yet (they say so plainly). */
export default async function DevelopersPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/developers">) {
  const { tenantId } = await params;
  const sp = await searchParams;
  if (!isCanonicalUuid(tenantId)) notFound();
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  if (role !== "owner" && role !== "admin") notFound();
  const tab: Tab = isTab(sp.tab) ? sp.tab : "overview";
  const ui = await getLang();
  const words = wordsFor(ui, ["dvp.", "dvh.", "apierr.", "sv6.dev.", "dev.", "dta.btn."]);
  const dev = tab === "keys" ? await readDeveloper(user.accessToken, tenantId) : null;
  const keys =
    dev && dev.mode === "ok" ? (
      <>
        <p className="m-0 text-[15px] text-muted">{words["dvp.test"]}</p>
        <DeveloperKeysCard words={words} lang={ui} keys={dev.keys} usage={dev.usage} mock={dev.mock} actions={{ create: createKeyAction.bind(null, tenantId), rotate: rotateKeyAction.bind(null, tenantId), revoke: revokeKeyAction.bind(null, tenantId) }} simple />
      </>
    ) : (
      <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
        {words["dvp.keys.off"]}
      </p>
    );
  // the tabs C1's routes opened (WEBHOOKS_OUT on the API; a 404 means "not open for this workspace", said plainly)
  const closed = (e: unknown): null => {
    if (e instanceof ApiAuthError) redirect("/login");
    if (!(e instanceof ApiRequestError && e.status === 404)) escalate(e);
    return null;
  };
  let hooks: React.ReactNode = null;
  if (tab === "hooks") {
    const [endpoints, events] = await Promise.all([listEndpoints(user.accessToken, tenantId).catch(closed), listEvents(user.accessToken, tenantId).catch(closed)]);
    hooks =
      endpoints && events ? (
        <WebhooksTab
          words={words}
          endpoints={endpoints}
          events={events}
          owner={role === "owner"}
          actions={{ create: createHookAction.bind(null, tenantId), change: changeHookAction.bind(null, tenantId), rotate: rotateHookAction.bind(null, tenantId), remove: deleteHookAction.bind(null, tenantId), test: testHookAction.bind(null, tenantId), log: deliveriesAction.bind(null, tenantId) }}
        />
      ) : (
        <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
          {words["dvh.off"]}
        </p>
      );
  }
  let activity: React.ReactNode = null;
  if (tab === "activity") {
    const [usage, first] = await Promise.all([getActivityUsage(user.accessToken, tenantId).catch(closed), listActivity(user.accessToken, tenantId, null).catch(closed)]);
    activity =
      usage || first ? (
        <ActivityTab words={words} usage={usage} first={first} load={activityAction.bind(null, tenantId)} />
      ) : (
        <p role="note" className="m-0 border-y border-line py-3 text-[15px] text-muted">
          {words["dvh.act.off"]}
        </p>
      );
  }
  return <DevelopersView words={words} ui={ui} base={`/app/tenants/${tenantId}/developers`} tab={tab} lang={isLang(sp.lang) ? sp.lang : "curl"} keys={keys} hooks={hooks} activity={activity} />;
}
