import { escalate } from "@/lib/api/failure";
import { redirect } from "next/navigation";

import { LazyLeadSources } from "@/components/v2/app/lead-desk/LazyLeadSources";
import { BeforeYouCall } from "@/components/v2/app/lead-desk/BeforeYouCall";
import { GuideCards } from "@/components/v2/app/lead-desk/GuideCards";
import { MoreWays } from "@/components/v2/app/lead-desk/MoreWays";
import { CARD_KINDS, type CardKind } from "@/lib/sources/types";
import { SourceCards } from "@/components/v2/app/lead-desk/LazySourceCards";
import { PageTop } from "@/components/v2/app/parts";
import { mutedText, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { readSources, sourcesMode } from "@/lib/lead-desk/sources/source";
import { jobsScreens } from "@/lib/screens/flag";
import { cardsMode, sourcesApiFor } from "@/lib/sources/server";

import {
  discardUnparsedAction,
  createSourceAction,
  pullIndiaMartAction,
  rotateSourceAction,
  sourceStatusAction,
} from "../lead-sources-actions";
import { leadDeskContext } from "../lead-desk-prelude";
import { menuTitle } from "../menu-title";

export const metadata = { title: `Lead sources · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/lead-sources (night 4, Lead Desk, item 4; a tab of Settings): where leads arrive from by themselves, with a card for each (Meta Lead Ads, IndiaMART, JustDial and other portals, your website form,
 * Google Sheets, a webhook), their status, a new address when one leaks, and the mails nobody could read. Owner and Admin; everyone else gets "not found". Behind LEADS_SCREENS. The address of a source is shown once, in
 * the component, and is not on this page's server output.
 */
export default async function LeadSourcesRoute({
  params,
  searchParams,
}: PageProps<"/app/tenants/[tenantId]/lead-sources">) {
  const { tenantId } = await params;
  const { meta, card: openCard } = await searchParams;
  const got = await leadDeskContext(tenantId, ["owner", "admin"]);
  if (!got.ok) return got.page;
  // the cards (job context-and-easy-sources part B), read here once; a card that cannot be read leaves the old list as it was
  const cardsApi = sourcesApiFor(cardsMode(), got.ctx.accessToken, tenantId);
  const cards = cardsApi
    ? await cardsApi
        .cards()
        .catch((error) =>
          error instanceof ApiAuthError ? redirect("/login") : null,
        )
    : null;
  let read;
  try {
    read = await readSources({ token: got.ctx.accessToken, tenantId });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const words = wordsFor(lang, [
    "scc.",
    "lsrc.",
    "bsc.",
    "lsg.",
    "li.consent.",
    "li.err.",
    "li.refused.",
    "li.tag.",
    "li.cost.",
    "sc.",
    "lsrc.copy",
    ...(jobsScreens() !== "off" ? ["jobs.trust.consent"] : []),
  ]);
  const list =
    read.mode === "ok" ? (
      <LazyLeadSources
        words={words}
        base={`/app/tenants/${tenantId}`}
        test={sourcesMode() === "mock"}
        sources={read.sources}
        unparsed={read.unparsed}
        actions={{
          create: createSourceAction.bind(null, tenantId),
          rotate: rotateSourceAction.bind(null, tenantId),
          status: sourceStatusAction.bind(null, tenantId),
          pull: pullIndiaMartAction.bind(null, tenantId),
          discard: discardUnparsedAction.bind(null, tenantId),
        }}
      />
    ) : null;
  return (
    <main className={pageMain} lang={lang}>
      <PageTop
        title={await menuTitle("sources", lang, got.ctx.accessToken, tenantId)}
        sub={cards?.ok ? words["sc.sub"] : words["lsrc.sub"]}
      />
      <div className="mt-4">
        <BeforeYouCall words={words} open={false} />
      </div>
      {cards?.ok ? (
        <SourceCards
          words={words}
          initial={cards.data}
          endpoint={`/app/tenants/${tenantId}/lead-sources/cards`}
          base={`/app/tenants/${tenantId}`}
          metaReturn={meta === "connected"}
          consentTick={jobsScreens() !== "off"}
          openCard={typeof openCard === "string" && (CARD_KINDS as readonly string[]).includes(openCard) ? (openCard as CardKind) : null}
        />
      ) : null}
      {read.mode === "ok" ? (
        cards?.ok ? (
          <MoreWays
            title={words["sc.more"] ?? ""}
            open={read.unparsed.length > 0}
          >
            {list}
          </MoreWays>
        ) : (
          list
        )
      ) : cards?.ok ? null : (
        // the one error line is for a page that shows nothing: when the cards are drawn, the older list of addresses ("More ways") is simply not there (it said "could not be loaded" under working cards)
        <p className={mutedText}>{words["lsrc.unavailable"]}</p>
      )}
      <div className="mt-8">
        <GuideCards words={words} base={`/app/tenants/${tenantId}`} />
      </div>
    </main>
  );
}
