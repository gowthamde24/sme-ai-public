import Link from "next/link";
import { notFound } from "next/navigation";

import { BatchView } from "@/components/v2/app/outreach/BatchView";
import { PageTop } from "@/components/v2/app/parts";
import { backLink, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readBatch, readItems } from "@/lib/outreach/source";
import { channelNames } from "@/lib/outreach/words";
import { outreachScreens } from "@/lib/screens/flag";

import { leadContext } from "../../../lead-context";
import { approveBatchAction, batchControlAction, excludeAction } from "../../../outreach-actions";

export const metadata = { title: `A plan for your leads · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/outreach/batches/[batchId] (night 4, part A3): ONE plan, the way it is shown wherever it comes from. While it waits it is the plan card with ONE "Approve all" (Owner, second factor); once approved it shows
 * the progress and the people, with pause, resume and cancel. In test mode the calls are simulated and the card says so.
 */
export default async function BatchPage({ params }: PageProps<"/app/tenants/[tenantId]/outreach/batches/[batchId]">) {
  const { tenantId, batchId } = await params;
  if (!isCanonicalUuid(batchId)) notFound();
  const got = await leadContext(tenantId, { roles: ["owner", "admin", "sales"], on: outreachScreens() !== "off" });
  if (!got.ok) return got.page;
  const { accessToken, userId, tenant } = got.ctx;
  const ctx = { token: accessToken, tenantId, userId };
  const [answer, items] = await Promise.all([readBatch(ctx, batchId), readItems(ctx, batchId)]);
  if (!answer) notFound();
  const lang = await getLang();
  const words = wordsFor(lang, ["ol.", "pc.", "ld.goal.", "ld.source."]);
  const base = `/app/tenants/${tenantId}`;
  const { batch, plan } = answer;
  const when = (words["ol.when"] ?? "{from} to {to}").replace("{from}", plan.windowFrom ?? "").replace("{to}", plan.windowTo ?? "");
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={batch.name} sub={words["ol.batch.sub"] ?? ""} />
      <p className="mt-3">
        <Link href={`${base}/outreach`} className={backLink}>
          {words["ol.back"]}
        </Link>
      </p>
      <div className="mt-6 max-w-3xl">
        <BatchView
          words={words}
          initial={answer}
          items={items?.items ?? []}
          canApprove={tenant.role === "owner"}
          canDecide={tenant.role === "owner" || tenant.role === "admin"}
          canCancel={tenant.role === "owner"}
          simulated
          channelWords={channelNames(words)}
          goalWord={`ld.goal.${batch.goal}`}
          whenText={when}
          securityHref="/app/security"
          actions={{ exclude: excludeAction.bind(null, tenantId, batchId), approve: approveBatchAction.bind(null, tenantId, batchId), control: batchControlAction.bind(null, tenantId, batchId) }}
        />
      </div>
    </main>
  );
}
