import Link from "next/link";
import { redirect } from "next/navigation";

import { Repoll } from "@/components/v2/app/calls/CallClient";
import { TestCallForm } from "@/components/v2/app/calls/LazyTestCallForm";
import { PageTop } from "@/components/v2/app/parts";
import { alertBox, btnMain, btnQuiet, noteBox, pageMain, pillAmber, pillGreen, pillNeutral, surface } from "@/components/v2/app/ui";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { getCall, listTestNumbers, type CallDetail, type TestNumber } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError } from "@/lib/api/client";
import { refusedKey, TEST_LANGUAGES } from "@/lib/calls/test-call";

import { getTalkTraining } from "@/lib/api/talk-training";
import { talkTrainingScreens } from "@/lib/screens/flag";
import type { IntroduceAs } from "@/lib/talk-training/introduce";
import { placeTestCallAction } from "./actions";

/**
 * The owner's "Place a test call" (job test-call, 10 Nov 2026), drawn by the Calls page itself when it is asked for `?test=1` (a page of its own would be a new route, and every new route adds to the first-load script of all of them: the
 * route-JS budget of /outbox has 29 B of room). Only with APP_V4 and TEST_CALL_SCREENS, only for the Owner (the page checks both before it calls this). `&call=<id>` shows that call's state, read again every few seconds while it is live,
 * with a link to the call under Phone calls (tagged "Test call"). The phones that may be rung come from C1's masked list; a full number never reaches the browser.
 */
export async function TestCallView({ token, tenantId, callId, business = null }: { token: string; tenantId: string; callId: string | null; business?: string | null }) {
  let call: CallDetail | null = null;
  if (callId) {
    try {
      call = await getCall(token, tenantId, callId);
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
      numbers = await listTestNumbers(token, tenantId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      off = error instanceof ApiRequestError && error.code === "calls_unavailable";
    }
  }
  // "Introduce as" (C1, 11 Nov): the saved setting, read only where the API has the field (an older API: nothing is offered, nothing is sent)
  let introduceSaved: IntroduceAs | null = null;
  if (!callId && talkTrainingScreens()) {
    try {
      introduceSaved = (await getTalkTraining(token, tenantId)).training.introduceAs;
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
    }
  }
  const lang = await getLang();
  const w = wordsFor(lang, ["tc.", "ph.state.", "ph.test", "tt.intro."]);
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
                  <Link href={`${base}/calls?test=1`} className={btnQuiet} data-part="test-call-again">
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
          <TestCallForm w={w} base={base} numbers={numbers} languages={languages} place={placeTestCallAction.bind(null, tenantId)} introduce={introduceSaved ? { saved: introduceSaved, business } : null} />
        )}
      </div>
      {live ? <Repoll seconds={3} /> : null}
    </main>
  );
}
