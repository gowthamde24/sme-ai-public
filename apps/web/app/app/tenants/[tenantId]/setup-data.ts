import type { SetupFacts } from "@/components/v2/app/setup/types";
import { ApiAuthError } from "@/lib/api/client";
import { listCatalogueItems } from "@/lib/api/catalogue";
import { fetchMembers } from "@/lib/api/orders";
import { getOutboxSettings } from "@/lib/api/outbox";
import { getVisitSettings } from "@/lib/api/visits";

/** One read that may fail: null, except a rejected session, which the caller sends to sign-in. */
async function maybe<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiAuthError) throw error;
    return null;
  }
}

/**
 * The facts the setup wizard and the checklist on Today stand on (job BJ; Owner only): the shop hours (and whether the business has saved its own), whether the catalogue has a saree, the outbox's
 * automatic-sending switch and quiet hours, the number of members. Existing endpoints only; each read stands alone, so one that fails leaves the others, and an unknown part is null.
 */
export async function readSetupFacts(accessToken: string, tenantId: string, shop: string): Promise<SetupFacts> {
  const [hours, sarees, outbox, members] = await Promise.all([
    maybe(() => getVisitSettings(accessToken, tenantId)),
    maybe(() => listCatalogueItems(accessToken, tenantId, { limit: 1, includeInactive: true })),
    maybe(() => getOutboxSettings(accessToken, tenantId)),
    maybe(() => fetchMembers(accessToken, tenantId)),
  ]);
  return {
    shop,
    hours: hours ? { settings: hours, saved: !hours.is_default } : null,
    sarees: sarees ? sarees.items.length : null,
    sending: outbox ? { auto: outbox.auto_send_enabled, quietStart: outbox.quiet_hours_start, quietEnd: outbox.quiet_hours_end, platformOn: outbox.platform_switch_on } : null,
    members: members ? members.length : null,
  };
}
