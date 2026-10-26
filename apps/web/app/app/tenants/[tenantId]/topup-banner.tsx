import { TopupBanner } from "@/components/v2/app/topups/TopupBanner";
import { topupAlert } from "@/components/v2/app/topups/alert-text";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { fetchTenant } from "@/lib/api/client";
import { topupScreens } from "@/lib/screens/flag";
import { readUsageCached } from "@/lib/topups/source";

/**
 * The notice at 80 and 100 percent of the minutes or messages, for the layout of a workspace (night 4, part F2). It costs nothing when TOPUP_SCREENS is off (it answers before reading anything), when the person is not the Owner or
 * an Admin, when the usage cannot be read, and while both meters are below 80 percent; and it is markup only (no script). A read that fails draws nothing: the notice is a help, never a reason for a screen to fail.
 */
export async function TopupLayoutBanner({ token, tenantId, lang }: { token: string; tenantId: string; lang: Lang }) {
  if (topupScreens() === "off") return null;
  try {
    const tenant = await fetchTenant(token, tenantId);
    if (tenant.role !== "owner" && tenant.role !== "admin") return null;
    const usage = await readUsageCached(token, tenantId);
    if (!usage || !topupAlert(usage)) return null;
    return <TopupBanner words={wordsFor(lang, ["tu.alert.", "tu.cta."])} usage={usage} href={`/app/tenants/${tenantId}/settings?section=plan#topups`} canBuy={tenant.role === "owner"} />;
  } catch {
    return null;
  }
}
