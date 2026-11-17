import Link from "next/link";

import { PageTop } from "@/components/v2/app/parts";
import { MarketingConsentList } from "@/components/v2/app/campaigns/MarketingConsentList";
import { btnMainLink, mutedText, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { listMarketingConsent, STATES, type MarketingState } from "@/lib/api/marketing-consent";
import { offerScreens } from "@/lib/screens/flag";

import { leadContext } from "../lead-context";
import { recordYesAction, withdrawAction } from "./actions";

export const metadata = { title: `Who wants offers · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * /app/tenants/[tenantId]/marketing-consent (campaigns S4, behind OFFER_SCREENS; a tab under More on Campaigns): who said yes to offers. The counts cover the whole book; the list is by name (never a number), a search box and a state
 * filter in the address. Owner, Admin and Sales read it and record a yes (with how it was given) or a no. Nothing here sends a message.
 */
export default async function MarketingConsentPage({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/marketing-consent">) {
  const { tenantId } = await params;
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales"], on: offerScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken } = got.ctx;
  const sp = await searchParams;
  const q = (first(sp.q) ?? "").trim().slice(0, 60);
  const stateRaw = first(sp.state);
  const state = (STATES as readonly string[]).includes(stateRaw ?? "") ? (stateRaw as MarketingState) : undefined;
  const after = first(sp.after) ?? null;
  const lang = await getLang();
  const words = wordsFor(lang, ["mc."], ["of.new.link"]);
  const base = `/app/tenants/${tenantId}`;
  const list = await listMarketingConsent(accessToken, tenantId, { q, ...(state ? { state } : {}), after }).catch(() => null);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["mc.title"] ?? ""} sub={words["mc.sub"] ?? ""} />
      <p className="mt-3">
        <Link href={`${base}/campaigns/new-offer`} className={btnMainLink} data-part="new-offer">
          {words["of.new.link"]}
        </Link>
      </p>
      {list === null ? (
        <p className={mutedText}>{words["mc.na"]}</p>
      ) : (
        <MarketingConsentList words={words} lang={lang} base={`${base}/marketing-consent`} q={q} state={state ?? null} list={list} after={after} actions={{ yes: recordYesAction.bind(null, tenantId), no: withdrawAction.bind(null, tenantId) }} />
      )}
    </main>
  );
}
