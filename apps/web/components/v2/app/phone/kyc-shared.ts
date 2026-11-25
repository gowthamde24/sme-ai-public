import { KYC_REASONS, type KycReason } from "@/lib/api/business-kyc";
import type { UnavailableReason } from "@/lib/phone-picker/types";
import type { Say } from "../words";

/** What the verification starts from (kept in this browser tab only; nothing is sent): the account type and the name typed in step 2 of "Get a phone number". */
export const PREFILL_KEY = "s19.verify.prefill";

const isKyc = (r: string | undefined): r is KycReason => r !== undefined && (KYC_REASONS as readonly string[]).includes(r);
const PICKER_WHY: readonly UnavailableReason[] = ["not_on_plan", "already_has_number", "paused", "kyc_required"];

/** The one sentence for a refusal: a reason of the number picker or of the business account, else the kind of failure. */
export function refusalSentence(t: Say, error: string, reason?: string): string {
  if (isKyc(reason)) return t(`pick.kyc.err.${reason}`);
  if (reason && (PICKER_WHY as readonly string[]).includes(reason)) return t(`pick.why.${reason}`);
  const known: Record<string, string> = { invalid: "pick.err.prefix", forbidden: "pick.err.forbidden", step_up: "pick.err.stepup", taken: "pick.err.taken", unavailable: "pick.err.now", down: "pick.err.down", refused: "pick.kyc.err.refused" };
  return t(known[error] ?? "pick.err.down");
}
