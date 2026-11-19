import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EffectLine } from "@/components/v2/app/jobs/pages/parts";
import { PageTop } from "@/components/v2/app/parts";
import { SellSection } from "@/components/v2/app/sell/LazySection";
import { pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readWhatYouSell } from "@/lib/api/what-you-sell";
import { requireUser } from "@/lib/auth/session";
import { readPackCached } from "@/lib/packs/read";
import { jobsScreens } from "@/lib/screens/flag";
import { ENTRY_PATH, oldPagesOf, styleOfPack } from "@/lib/sell/style";
import { SELL_STYLES } from "@/lib/sell/types";

import { readSheetAction, saveEntryAction, understandAction } from "./actions";

export const metadata = { title: `What you sell · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/what-you-sell (JOBS, owner decision 19 Nov; mock r3-04): what the business sells, in the ONE style its business type's pack chooses (Products, Services, Courses, Properties or Price lists), filled by saying it, taking photos or importing
 * a sheet. It REPLACES the Catalogue entry of the menu while JOBS is on; the old Catalogue pages keep their addresses and stay one tap away ("Open the old page"). Not there (404) while JOBS is off. Everyone who may open the workspace reads it; Owner and Admin change it.
 * In test mode (JOBS=mock) `?style=` shows another style, so all five can be looked at; a real workspace always gets its pack's style.
 */
export default async function WhatYouSellRoute({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/what-you-sell">) {
  if (jobsScreens() === "off") notFound();
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) notFound();
  const { style: asked } = await searchParams;
  const user = await requireUser();
  let role: string;
  try {
    role = (await fetchTenant(user.accessToken, tenantId)).role;
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    notFound();
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["jobs.sell.", "catalogue.colour."]);
  const pack = await readPackCached(user.accessToken, tenantId).catch((error) => (error instanceof ApiAuthError ? redirect("/login") : null));
  const pick = typeof asked === "string" && jobsScreens() === "mock" ? SELL_STYLES.find((s) => s === asked) : undefined;
  const style = pick ?? styleOfPack(pack?.packId);
  const modules = pack?.modules ?? null;
  const read = await readWhatYouSell(user.accessToken, tenantId, style, modules);
  const base = `/app/tenants/${tenantId}`;
  const owns = role === "owner" || role === "admin";
  const old = oldPagesOf(style, modules, jobsScreens() === "mock").map((o) => ({ href: `${base}${o.path}`, word: o.word }));
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["jobs.sell.page.title"] ?? "What you sell"} sub={words["jobs.sell.page.sub"]} />
      {read.state === "ready" ? (
        <>
          {read.data.live ? null : <div className="mt-4"><EffectLine part="test-mode" text={words["jobs.sell.mock"] ?? ""} /></div>}
          <SellSection
            style={style}
            entries={read.data.entries}
            words={words}
            base={base}
            actions={owns ? { save: saveEntryAction.bind(null, tenantId), understand: understandAction.bind(null, tenantId), readSheet: readSheetAction.bind(null, tenantId) } : null}
            live={read.data.live}
            ownerPrice={role === "owner"}
            paths={ENTRY_PATH[style]}
            oldLinks={old}
          />
        </>
      ) : (
        <div data-part={read.state} className="flex flex-col gap-3">
          <p className="m-0 text-muted">{words[read.state === "unready" ? "jobs.sell.unready" : "jobs.sell.unread"]}</p>
          {old.map((o) => (
            <p key={o.href} className="m-0">
              <Link href={o.href} prefetch={false} className="font-semibold text-brand-text underline underline-offset-4">
                {words[`jobs.sell.${o.word}`]}
              </Link>
            </p>
          ))}
        </div>
      )}
    </main>
  );
}
