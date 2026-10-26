import { NeedsYouTopup } from "@/components/v2/app/topups/NeedsYouTopup";
import { WaitingCard } from "@/components/v2/app/topups/WaitingCard";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { topupScreens } from "@/lib/screens/flag";
import { readUsageCached } from "@/lib/topups/source";

/**
 * Today's two cards for the minutes and messages running out (night 4, part F2): the "Needs you" card at 80 and 100 percent and "12 leads waiting for calls · Top up". Markup only, no script, nothing at all while TOPUP_SCREENS is off or
 * both meters are below 80 percent and no call waits. Owner and Admin only (the usage is theirs; the caller checks). A read that fails draws nothing.
 */
export async function topupsToday({ token, tenantId, lang, owner }: { token: string; tenantId: string; lang: Lang; owner: boolean }) {
  if (topupScreens() === "off") return null;
  const usage = await readUsageCached(token, tenantId).catch(() => null);
  if (!usage) return null;
  const words = wordsFor(lang, ["tu.alert.", "tu.cta.", "tu.needs.", "tu.wait."]);
  const href = `/app/tenants/${tenantId}/settings?section=plan#topups`;
  return (
    <div data-part="topups">
      <NeedsYouTopup words={words} usage={usage} href={href} canBuy={owner} />
      <WaitingCard words={words} waiting={usage.queuedCalls} href={href} canBuy={owner} />
    </div>
  );
}
