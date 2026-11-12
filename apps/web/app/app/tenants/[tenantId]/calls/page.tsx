import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Repoll } from "@/components/v2/app/calls/CallClient";
import { CallsList } from "@/components/v2/app/calls/CallsList";
import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { btnMain, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { partsWords, wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { listCalls, type CallsPage } from "@/lib/api/calls";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { appV4, testCallScreens } from "@/lib/screens/flag";

import { TestCallView } from "./test-call-view";

export const metadata = { title: `Phone calls · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/calls (app v4 part 4; only with APP_V4, else 404): the assistant's phone calls, live first (docs/contracts/calls.md GET /calls). For the Owner, Admin and Sales (a Viewer has no calls: 404, as the live page).
 * While a call is live the page reads itself again every `poll_after_s` seconds. A list that cannot be read says so; it is never filled in.
 */
export default async function CallsPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/calls">) {
  if (!appV4()) notFound();
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const sp = await searchParams;
  const raw = pick(sp.cursor);
  const cursor = raw && raw.length <= 40 && !Number.isNaN(Date.parse(raw)) ? raw : null;
  let role: string;
  let business: string | null = null;
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    role = tenant.role;
    business = tenant.name;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  if (role === "viewer") notFound(); // (outside the try: notFound works by throwing)
  // the owner's "Place a test call" (job test-call): the same route, `?test=1` (a route of its own would add to every page's first load); only with TEST_CALL_SCREENS, only the Owner's
  if (pick(sp.test) === "1" && testCallScreens()) {
    if (role !== "owner") notFound();
    const callRaw = pick(sp.call);
    return TestCallView({ token: user.accessToken, tenantId, business, callId: callRaw && isCanonicalUuid(callRaw) ? callRaw : null }); // (called, not drawn as a tag: it reads, so it is awaited here)
  }
  let page: CallsPage | null = null;
  try {
    page = await listCalls(user.accessToken, tenantId, cursor);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    // anything else: the list says it could not be read
  }
  const lang = await getLang();
  const w = wordsFor(lang, ["ph.", "outcome.cat.", "outcome.result.", "nav.item.phonecalls"], ["tc.title"]);
  const when = (iso: string) => new Intl.DateTimeFormat(`${lang}-IN`, { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const names = (() => {
    try {
      return new Intl.DisplayNames([lang], { type: "language" });
    } catch {
      return null;
    }
  })();
  const base = `/app/tenants/${tenantId}`;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={w["nav.item.phonecalls"]} sub={w["ph.sub"]} action={role === "owner" && testCallScreens() ? <Link href={`${base}/calls?test=1`} className={btnMain} data-part="test-call-entry">{w["tc.title"]}</Link> : undefined} />
      <div className="mt-6 max-w-3xl">
        <CallsList items={page?.items ?? null} base={base} w={w} when={when} language={(c) => names?.of(c) ?? null} olderHref={page?.nextCursor ? `${base}/calls?cursor=${encodeURIComponent(page.nextCursor)}` : null} />
      </div>
      {page && page.items.some((c) => c.live) && !cursor ? <Repoll seconds={page.pollAfterS} /> : null}
    </main>
  );
}
