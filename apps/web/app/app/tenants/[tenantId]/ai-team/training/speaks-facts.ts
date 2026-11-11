import { ApiAuthError } from "@/lib/api/client";
import { getTalkTraining } from "@/lib/api/talk-training";
import { readPackCached } from "@/lib/packs/read";
import type { Facts } from "@/lib/talk-training/speaks-source";
import type { LegacyAddress, SpeakTone } from "@/lib/talk-training/speaks";

import { readDisplayName } from "../../today-data";

/**
 * What the TEST MODE of "How your assistant speaks" needs from the page, because the real API knows it itself: the old "How to address customers" value (the Talk training document's `address`), the business type's usual tone (a school: Respectful, everything else: Friendly; C1's
 * packages/packs/call_tones.json), and the Owner's first name (letters only) for "My name". Not a "use server" file: these are not actions.
 */
export async function readFacts(token: string, tenantId: string, userId: string): Promise<Facts> {
  const [training, pack, name] = await Promise.all([
    getTalkTraining(token, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
    readPackCached(token, tenantId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
    readDisplayName(token, tenantId, userId).catch((e) => (e instanceof ApiAuthError ? Promise.reject(e) : null)),
  ]);
  const legacy: LegacyAddress | null = training?.training.address ?? null;
  const school = pack?.modules?.includes("programmes") === true;
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return { legacyAddress: legacy, packDefault: (school ? "respectful" : "friendly") as SpeakTone, ownerName: /^[\p{L}\p{M}]{2,40}$/u.test(first) ? first : null };
}
