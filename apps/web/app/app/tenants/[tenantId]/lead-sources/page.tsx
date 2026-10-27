import { escalate } from "@/lib/api/failure";
import { redirect } from "next/navigation";

import { LazyLeadSources } from "@/components/v2/app/lead-desk/LazyLeadSources";
import { PageTop } from "@/components/v2/app/parts";
import { mutedText, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiAuthError } from "@/lib/api/client";
import { readSources, sourcesMode } from "@/lib/lead-desk/sources/source";

import { discardUnparsedAction, createSourceAction, pullIndiaMartAction, rotateSourceAction, sourceStatusAction } from "../lead-sources-actions";
import { leadDeskContext } from "../lead-desk-prelude";

export const metadata = { title: `Lead sources · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/lead-sources (night 4, Lead Desk, item 4; a tab of Settings): where leads arrive from by themselves, with a card for each (Meta Lead Ads, IndiaMART, JustDial and other portals, your website form,
 * Google Sheets, a webhook), their status, a new address when one leaks, and the mails nobody could read. Owner and Admin; everyone else gets "not found". Behind LEADS_SCREENS. The address of a source is shown once, in
 * the component, and is not on this page's server output.
 */
export default async function LeadSourcesRoute({ params }: PageProps<"/app/tenants/[tenantId]/lead-sources">) {
  const { tenantId } = await params;
  const got = await leadDeskContext(tenantId, ["owner", "admin"]);
  if (!got.ok) return got.page;
  let read;
  try {
    read = await readSources({ token: got.ctx.accessToken, tenantId });
  } catch (error) {
    if (error instanceof ApiAuthError) redirect("/login");
    escalate(error);
    throw error;
  }
  const lang = await getLang();
  const words = wordsFor(lang, ["lsrc.", "li.consent.", "li.err.", "li.refused.", "li.tag.", "li.cost."]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["lsrc.title"] ?? "Lead sources"} sub={words["lsrc.sub"]} />
      {read.mode === "ok" ? (
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
      ) : (
        <p className={mutedText}>{words["lsrc.unavailable"]}</p>
      )}
    </main>
  );
}
