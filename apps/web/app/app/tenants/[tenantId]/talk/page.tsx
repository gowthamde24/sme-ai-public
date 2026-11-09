import { notFound, redirect } from "next/navigation";

import { ApiDownV2, PageTop } from "@/components/v2/app/parts";
import { TODAY_CHIPS } from "@/components/v2/app/today/ask/ask-chips";
import type { Availability } from "@/components/v2/app/today/ask/ask-types";
import { ASK_WORD_KEYS } from "@/components/v2/app/today/ask/ask-words";
import { TalkView } from "@/components/v2/app/today/ask/TalkView";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { appT } from "@/i18n/app";
import { partsWords } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { escalate } from "@/lib/api/failure";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import { withPackT } from "@/lib/packs/resolve";

import { menuTitle } from "../menu-title";
import { readAgentsCached } from "../today-read";

export const metadata = { title: `Talk to assistant · ${BRAND_NAME}` };
// Per-user data from the API: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** /app/tenants/[tenantId]/talk (Overview > Talk to assistant): the assistant's conversation on a page of its own (owner rule, 6 Nov: every menu item opens its own page). Any member. */
export default async function TalkPage({ params }: PageProps<"/app/tenants/[tenantId]/talk">) {
  const user = await requireUser();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  try {
    await fetchTenant(user.accessToken, tenantId);
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    escalate(error);
    return <ApiDownV2 words={await partsWords()} />;
  }
  const lang = await getLang();
  const pack = await readPackCached(user.accessToken, tenantId).catch(() => null);
  const t = pack ? withPackT(appT(lang), pack, lang) : appT(lang);
  const team = await readAgentsCached(user.accessToken, tenantId).catch((e) => (e instanceof ApiAuthError ? redirect("/login") : null));
  const main = team?.find((a) => a.agent === "main")?.state;
  const availability: Availability = main === "idle" || main === "working" ? "live" : main === "switched_off" ? "switched_off" : "not_available";
  const tt = (k: string) => t(k as "frame.notyet");
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={await menuTitle("assistant", lang, user.accessToken, tenantId)} sub={tt("talk.sub")} />
      <div className="mt-6 max-w-4xl">
        <TalkView lang={lang} base={`/app/tenants/${tenantId}`} availability={availability} words={Object.fromEntries(ASK_WORD_KEYS.map((k) => [k, tt(k)]))} chips={TODAY_CHIPS.map((k) => tt(k))} />
      </div>
    </main>
  );
}
