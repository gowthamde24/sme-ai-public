import { redirect } from "next/navigation";

import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { CallsV6 } from "@/components/v2/app/calls/v6/CallsV6";
import { Repoll } from "@/components/v2/app/calls/v6/Lazy";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { getCall, listCalls, type CallDetail, type CallsPage } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, publicApiBase } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchTimeline, type TimelineItem } from "@/lib/api/customer-timeline";
import { callsHref, defaultCallId, parseCallsQuery, shortWhen } from "@/lib/calls/filter";
import { refuseWhy } from "@/lib/calls/view";
import { takeOverSocketUrl } from "@/lib/calls/take-over";
import { teachScreens, testCallScreens } from "@/lib/screens/flag";

import { hangUpCallAction } from "./actions";
import { approveCallQuoteAction, whisperCallAction } from "./v6-actions";
import { teachAction, undoTeachAction } from "../teach-actions";

/** The moment the page is drawn (ms), read once, so every "today" on it agrees. */
const clock = (): number => Date.now();

/** The next page of calls follows the API's cursor (`?cursor=`, a time the API gave); kept as the existing page does. */
const cursorOf = (raw: string | string[] | undefined): string | null => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null;
};

/**
 * The Calls page of design system v6 (DESIGN_V6), for /calls and /calls/[callId] alike: the list the API sent, the filters from the address, and the open call (its detail, and its customer's timeline for the outcome card). The role is the one the page already read. Owner and Admin
 * get Teach this (when TEACH_SCREENS is on), Approve, Whisper, Take over and End; Sales reads the list and the summary (the API gives Sales no transcript); a Viewer never gets here. A part that cannot be read says so in its place and the rest still draws.
 */
export async function CallsV6Page(o: { token: string; tenantId: string; role: string; callId: string | null; searchParams: Record<string, string | string[] | undefined> }) {
  const { token, tenantId, role } = o;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const query = parseCallsQuery(o.searchParams);
  const cursor = cursorOf(o.searchParams.cursor);
  const callId = o.callId && isCanonicalUuid(o.callId) ? o.callId : null;
  const owner = role === "owner";
  const writer = owner || role === "admin";

  let page: CallsPage | null = null;
  let call: CallDetail | null = null;
  let timeline: TimelineItem[] | null = null;
  const words = wordsFor(lang, ["calls6.", "ph.", "outcome.cat.", "outcome.result.", "dst.teach", "today.err."], ["dta.btn.working"]);
  const now = clock();
  const why = (reason: string | null) => words[`ph.why.${refuseWhy(reason)}`] ?? "";
  const listed = await Promise.allSettled([listCalls(token, tenantId, cursor)]).then(([r]) => r);
  if (listed.status === "fulfilled") page = listed.value;
  else if (listed.reason instanceof ApiAuthError) redirect("/login");
  // the call the panel shows: the one in the address; else the live call, else the newest (approved mock). Only a call picked in the address opens the panel on a phone.
  const shownId = callId ?? (page ? defaultCallId(page.items, query, now, words, why) : null);
  if (shownId) {
    try {
      call = await getCall(token, tenantId, shownId);
    } catch (error) {
      if (error instanceof ApiAuthError) redirect("/login");
      call = null;
    }
  }
  if (call?.leadId && !call.live) {
    timeline = await fetchTimeline(token, tenantId, call.leadId, null, 30).then((p) => p.items).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null));
  }

  const when = (iso: string) => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  let language: string | null = null;
  try {
    language = call?.language ? (new Intl.DisplayNames([lang], { type: "language" }).of(call.language) ?? null) : null;
  } catch {
    language = null;
  }
  const takeOverUrl = call !== null && call.live && writer && call.state === "in_progress" && call.canTakeOver ? takeOverSocketUrl(publicApiBase(), tenantId, call.id) : null;
  const liveControls = call && call.live
    ? {
        whisper: writer && call.state === "in_progress" ? async (text: string) => whisperCallAction(tenantId, call.id, text) : null,
        end: writer ? hangUpCallAction.bind(null, tenantId, call.id) : null,
        takeOver: takeOverUrl ? { url: takeOverUrl, tokenUrl: `${base}/calls/${call.id}/take-over-token` } : null,
        ringing: call.state !== "in_progress",
      }
    : null;
  const olderHref = page?.nextCursor ? `${callsHref(base, query)}${callsHref(base, query).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(page.nextCursor)}` : null;
  const anyLive = (page?.items.some((c) => c.live) ?? false) || call?.live === true;
  return (
    <CallsV6
      words={words}
      lang={lang}
      base={base}
      query={query}
      calls={page?.items ?? null}
      now={now}
      olderHref={olderHref}
      selectedId={shownId}
      phoneOpen={callId !== null}
      selected={shownId ? { call, timeline } : null}
      shortWhen={(iso) => shortWhen(iso, now, lang)}
      when={when}
      language={language}
      canRead={writer}
      teach={writer && teachScreens() !== "off" ? { save: teachAction.bind(null, tenantId), undo: undoTeachAction.bind(null, tenantId) } : null}
      approve={writer ? approveCallQuoteAction.bind(null, tenantId) : null}
      liveControls={liveControls}
      help={helpTipFor(lang, base, "calls", true)}
      testHref={owner && testCallScreens() ? `${base}/calls?test=1` : null}
      repoll={anyLive && !cursor ? <Repoll seconds={page?.pollAfterS ?? 5} /> : null}
    />
  );
}
