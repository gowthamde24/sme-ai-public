import Link from "next/link";
import { notFound } from "next/navigation";

import { CallSettingsAdvanced } from "@/components/v2/app/assistant/LazyCallSettingsAdvanced";
import { PageTop } from "@/components/v2/app/parts";
import { link, pageMain } from "@/components/v2/app/ui";
import { BRAND_NAME } from "@/design/brand";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { ApiRequestError } from "@/lib/api/client";
import { getCampaign } from "@/lib/api/campaigns";
import { isCanonicalUuid } from "@/lib/api/crm";
import { readCampaignCalls } from "@/lib/call-settings/campaign-source";
import { callSettingsScreens } from "@/lib/screens/flag";

import { clearCampaignCallsAction, saveCampaignCallsAction } from "../../../campaign-call-settings-actions";
import { campaignContext } from "../../prelude";

export const metadata = { title: `Call settings for a campaign · ${BRAND_NAME}` };
export const dynamic = "force-dynamic";

/**
 * /app/tenants/[tenantId]/campaigns/[campaignId]/call-settings (job DQ part 3): how the AI assistant behaves on the phone FOR THIS CAMPAIGN. It starts from what the campaign uses now (the workspace's call settings with its own changes
 * laid over them), marks what is different here, saves only what differs, and can go back to following the workspace. Owner and Admin open it, only the Owner saves; behind CALL_SETTINGS_SCREENS like the workspace's own call settings.
 */
export default async function CampaignCallSettingsRoute({ params }: PageProps<"/app/tenants/[tenantId]/campaigns/[campaignId]/call-settings">) {
  const { tenantId, campaignId } = await params;
  if (!isCanonicalUuid(campaignId)) notFound();
  const got = await campaignContext(tenantId);
  if (!got.ok) return got.page;
  const { accessToken, tenant, pack } = got.ctx;
  if ((tenant.role !== "owner" && tenant.role !== "admin") || callSettingsScreens() === "off") notFound();
  let campaign;
  try {
    campaign = await getCampaign(accessToken, tenantId, campaignId);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    notFound();
  }
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const read = await readCampaignCalls({ token: accessToken, tenantId }, campaignId, pack?.modules ?? null);
  const words = wordsFor(lang, ["calls."], ["asst.hours.from", "asst.hours.to", "asst.hours.t", ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `asst.day.${d}`), "today.err.mfa", "today.err.mfa.link", "frame.notyet", "nav.item.campaigns"]);
  return (
    <main className={pageMain} lang={lang}>
      <PageTop title={words["calls.c.title"] ?? "Call settings for this campaign"} sub={campaign.name} />
      <p className="mt-3">
        <Link href={`${base}/campaigns/${campaignId}`} className={link}>
          {words["calls.c.back"] ?? "Back to the campaign"}
        </Link>
      </p>
      <div className="mt-6 max-w-3xl">
        {read.mode === "ok" ? (
          <CallSettingsAdvanced
            words={words}
            initial={read.effective}
            locked={read.lockedPurposes as never}
            canEdit={tenant.role === "owner"}
            mock={callSettingsScreens() === "mock"}
            saved={read.overridden.length > 0}
            actions={{ save: saveCampaignCallsAction.bind(null, tenantId, campaignId) }}
            campaign={{ base: read.base, clear: clearCampaignCallsAction.bind(null, tenantId, campaignId), settingsHref: `${base}/settings?section=assistant`, backHref: `${base}/campaigns/${campaignId}` }}
          />
        ) : (
          <p className="text-base text-muted">{words["frame.notyet"] ?? "Not available yet"}</p>
        )}
      </div>
    </main>
  );
}
