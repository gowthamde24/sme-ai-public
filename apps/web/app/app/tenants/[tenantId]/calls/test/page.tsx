import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Repoll } from "@/components/v2/app/calls/CallClient";
import { TestCallForm } from "@/components/v2/app/calls/TestCallForm";
import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { alertBox, btnMain, btnQuiet, noteBox, pageMain, pillAmber, pillGreen, pillNeutral, surface } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { getCall, listTestNumbers, type CallDetail, type TestNumber } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { refusedKey, TEST_LANGUAGES } from "@/lib/calls/test-call";
import { appV4, testCallScreens } from "@/lib/screens/flag";

import { placeTestCallAction } from "../actions";

export const metadata = { title: `Place a test call · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/calls/test (job test-call, 10 Nov 2026; only with APP_V4 and TEST_CALL_SCREENS, only for the Owner, else 404): the owner places ONE test call from the signed-in app (C1's PR #434, POST /calls/place) to a
 * number on the deployment's test list. `?call=<id>` shows that call's state, read again every few seconds while it is live, with a link to the call under Phone calls (tagged "Test call").
 */
export default async function TestCallPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/calls/test">) {
  if (!appV4() || !testCallScreens()) notFound();
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const raw = pick((await searchParams).call);
  const callId = raw && isCanonicalUuid(raw) ? raw : null;
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (role !== "owner") notFound(); // (outside the try: notFound works by throwing)
  let call: CallDetail | null = null;
  if (callId) {
    try {
      call = await getCall(user.accessToken, tenantId, callId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      // the call could not be read: the status says so below
    }
  }
  // the phones that may be rung (masked): read only for the form, never for a status page
  let numbers: TestNumber[] | null = null;
  let off = false;
  if (!callId) {
    try {
      numbers = await listTestNumbers(user.accessToken, tenantId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      off = error instanceof ApiRequestError && error.code === "calls_unavailable";
    }
  }
  const lang = await getLang();
  const w = wordsFor(lang, ["tc.", "ph.state.", "ph.test"]);
  const names = (() => {
    try {
      return new Intl.DisplayNames([lang], { type: "language" });
    } catch {
      return null;
    }
  })();
  const languages = TEST_LANGUAGES.map((code) => ({ code, label: names?.of(code) ?? code }));
  const base = `/app/tenants/${tenantId}`;
  const live = call !== null && (call.live || call.state === "queued" || call.state === "ringing");
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={w["tc.title"]} sub={w["tc.sub"]} />
      <div className="mt-6 flex max-w-3xl flex-col gap-6">
        {callId ? (
          <section className={`${surface} flex flex-col gap-3`} data-part="test-call-status" aria-labelledby="tc-status-h">
            <h2 id="tc-status-h" className="m-0 font-display text-xl font-bold">
              {w["tc.status.title"]}
            </h2>
            {call ? (
              <>
                <p className="m-0 flex flex-wrap items-center gap-2" role="status" aria-live="polite">
                  <span className={call.state === "completed" ? pillGreen : call.state === "refused" || call.state === "failed" ? pillAmber : pillNeutral}>{w[`ph.state.${call.state}`]}</span>
                  <span className={pillNeutral}>{w["ph.test"]}</span>
                </p>
                {call.state === "refused" ? <p className={`${alertBox} m-0`}>{w[refusedKey(call.refuseReason)]}</p> : null}
                {live ? <p className="m-0 text-sm text-muted">{w["tc.status.live"]}</p> : <p className="m-0 text-sm text-muted">{w["tc.status.over"]}</p>}
                <p className="m-0 text-sm text-muted">{w["tc.status.where"]}</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`${base}/calls/${callId}`} className={btnMain} data-part="test-call-open">
                    {w["tc.status.open"]}
                  </Link>
                  <Link href={`${base}/calls`} className={btnQuiet}>
                    {w["tc.status.all"]}
                  </Link>
                  <Link href={`${base}/calls/test`} className={btnQuiet} data-part="test-call-again">
                    {w["tc.again"]}
                  </Link>
                </div>
              </>
            ) : (
              <p role="alert" className={`${alertBox} m-0`}>
                {w["tc.err.down"]}
              </p>
            )}
          </section>
        ) : numbers === null ? (
          <p role="alert" className={`${alertBox} m-0`} data-part="test-call-off">
            {off ? w["tc.err.off"] : w["tc.err.down"]}
          </p>
        ) : numbers.length === 0 ? (
          <p role="status" className={`${noteBox} m-0`} data-part="test-call-nonumbers">
            {w["tc.nonumbers"]}
          </p>
        ) : (
          <TestCallForm w={w} base={base} numbers={numbers} languages={languages} place={placeTestCallAction.bind(null, tenantId)} />
        )}
      </div>
      {live ? <Repoll seconds={3} /> : null}
    </main>
  );
}
