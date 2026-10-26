import { TopupSection } from "@/components/v2/app/topups/TopupSection";
import { wordsFor } from "@/i18n/app-words";
import type { Lang } from "@/i18n/lang";
import { CATALOGUE, planById } from "@/lib/plan/catalogue";
import type { PlanCatalogue, WorkspacePlan } from "@/lib/plan/types";
import { topupScreens } from "@/lib/screens/flag";
import { upgradeTargets } from "@/lib/topups/mock";
import { readTopups } from "@/lib/topups/source";

import { buyTopupAction, previewUpgradeAction, saveTopupSettingsAction, simulateUsageAction, upgradeAction } from "../topup-actions";

/**
 * Usage and top-ups under the Plan part of Settings (night 4, part F2), read and drawn on the server: only while TOPUP_SCREENS is on, for the people who run the business; the buttons are bound to this workspace here (server
 * actions: the Owner only, the API asks for the second factor). The plan in force comes from the test provider or, with the API, from the Plan part's own read.
 */
export async function TopupsPart({ token, tenantId, lang, owner, plan, catalogue }: { token: string; tenantId: string; lang: Lang; owner: boolean; plan: WorkspacePlan | null; catalogue: PlanCatalogue | null }) {
  const mode = topupScreens();
  if (mode === "off") return null;
  const view = await readTopups({ token, tenantId });
  const cat = catalogue ?? CATALOGUE;
  const planId = view?.planId ?? plan?.planId ?? null;
  const upgrades = planId === null && mode === "on" ? [] : upgradeTargets(planId, cat).map((p) => ({ id: p.id, name: p.name }));
  return (
    <TopupSection
      words={wordsFor(lang, ["tu."], ["frame.notyet"])}
      view={view}
      canChange={owner}
      readOnly={plan?.access === "read_only"}
      mock={mode === "mock"}
      upgrades={upgrades}
      currentName={planById(planId, cat)?.name ?? null}
      topupHref={`/app/tenants/${tenantId}/settings?section=plan#topups`}
      actions={{
        buy: buyTopupAction.bind(null, tenantId),
        save: saveTopupSettingsAction.bind(null, tenantId),
        preview: previewUpgradeAction.bind(null, tenantId),
        upgrade: upgradeAction.bind(null, tenantId),
        simulate: mode === "mock" ? simulateUsageAction.bind(null, tenantId) : null,
      }}
    />
  );
}
