import { notFound, redirect } from "next/navigation";

import { CorrectIt, EndCall, EnglishLines, Repoll, TakeOver } from "@/components/v2/app/calls/CallClient";
import { CallView } from "@/components/v2/app/calls/CallView";
import { ApiDownV2 } from "@/components/v2/app/parts";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { getCall, type CallDetail } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, fetchTenant, publicApiBase } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchTimeline } from "@/lib/api/customer-timeline";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { takeOverSocketUrl } from "@/lib/calls/take-over";
import { capturedLabel, stagesDone } from "@/lib/calls/view";
import { appV4 } from "@/lib/screens/flag";

import { correctCallAction, hangUpCallAction } from "../actions";

export const metadata = { title: `Call · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/calls/[callId] (app v4 part 4; only with APP_V4): one call, live or finished (GET /calls/{id}). The workspace is read first (a Viewer has no calls), then the call; "Where X is now" from the customer's
 * timeline when the call has one (a timeline that cannot be read leaves the strip out). While the call is live the page reads itself again every 5 seconds. End call is the Owner's and Admin's; Correct it is for every role that
 * sees the call.
 */
export default async function CallPage({ params }: PageProps<"/app/tenants/[tenantId]/calls/[callId]">) {
  if (!appV4()) notFound();
  const user = await requireUser();
  const { tenantId, callId } = await params;
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(callId)) notFound();
  let role: string;
  let call: CallDetail | null = null;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
    // a Viewer has no calls: the call is not asked for (notFound below, outside the try: it works by throwing)
    if (role !== "viewer") call = await getCall(user.accessToken, tenantId, callId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 422)) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (!call) notFound();
  const lang = await getLang();
  const w = wordsFor(lang, ["ph.", "outcome.cat.", "outcome.result."]);
  const timeline = call.leadId ? await fetchTimeline(user.accessToken, tenantId, call.leadId, null, 100).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null)) : null;
  const when = (iso: string) => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  let language: string | null = null;
  try {
    language = call.language ? (new Intl.DisplayNames([lang], { type: "language" }).of(call.language) ?? null) : null;
  } catch {
    language = null;
  }
  const facts = { ...call.captured, ...(call.correction?.captured ?? {}) };
  const canEnd = call.live && (role === "owner" || role === "admin");
  // Take over (C1 #398): the Owner and an Admin, on a call that is live and answered (not while it still rings)
  const takeOverUrl = canEnd && call.state === "in_progress" ? takeOverSocketUrl(publicApiBase(), tenantId, callId) : null;
  return (
    <main className={pageMain} lang={lang}>
      <CallView
        call={call}
        base={`/app/tenants/${tenantId}`}
        w={w}
        when={when}
        language={language}
        stages={timeline ? stagesDone(timeline.items.map((i) => i.kind), call.live) : null}
        canRead={role === "owner" || role === "admin"}
        english={(has, lines) => (
          <EnglishLines userId={user.id} label={w["ph.en.show"]} has={has}>
            {lines}
          </EnglishLines>
        )}
        end={
          canEnd ? (
            <>
              {takeOverUrl ? <TakeOver w={w} url={takeOverUrl} tokenUrl={`/app/tenants/${tenantId}/calls/${callId}/take-over-token`} /> : null}
              <EndCall w={w} end={hangUpCallAction.bind(null, tenantId, callId)} />
            </>
          ) : null
        }
        correct={
          call.live ? null : (
            <CorrectIt
              w={w}
              start={{ summary: call.correction?.summary ?? call.summary ?? call.summaryShort ?? "", captured: facts, note: call.correction?.note ?? "" }}
              labels={Object.fromEntries(Object.keys(facts).map((k) => [k, capturedLabel(k)]))}
              correct={correctCallAction.bind(null, tenantId, callId)}
            />
          )
        }
      />
      {call.live ? <Repoll seconds={5} /> : null}
    </main>
  );
}
