import { actOnLink, importMode, importStep, makeSheetLink, previewStep, readStep, type Ctx } from "./source";
import { checkImportBody, checkPreviewBody, checkReadBody, checkSheetLinkBody, isUuid, type ImportResult, type Out, type PreviewResult, type ReadResult, type SheetLink } from "./types";

/**
 * The checks every write of the import screen goes through (night 4, item 3), shared by the server actions and by the one route that carries a file (a file is too big for a server action's body): the role, the flag, the shape
 * of what the browser sent. Roles (contract-lead-sources.md): read, preview and import = Owner, Admin, Sales; the consent confirmation = Owner and Admin only (a Sales member's leads are stored and nothing is sent to them);
 * the sheet links = Owner and Admin. A Viewer reaches nothing. The API is the real gate. SERVER ONLY.
 */
export type Role = "owner" | "admin" | "sales" | "viewer" | string;
export type Who = { ctx: Ctx; role: Role };
const MAY_IMPORT = ["owner", "admin", "sales"];
const MAY_CONFIRM = ["owner", "admin"];

export type Step = "read" | "preview" | "import";
export type StepData = ReadResult | PreviewResult | ImportResult;

export async function runImportStep(who: Who, step: Step, input: unknown): Promise<Out<StepData>> {
  if (importMode() === "off") return { ok: false, error: "not_available" };
  if (!MAY_IMPORT.includes(who.role)) return { ok: false, error: "forbidden" };
  if (step === "read") {
    const body = checkReadBody(input);
    return body.ok ? readStep(who.ctx, body.value) : { ok: false, error: body.error };
  }
  if (step === "preview") {
    const body = checkPreviewBody(input);
    if (!body.ok) return { ok: false, error: body.error };
    if (body.value.consent_confirmed && !MAY_CONFIRM.includes(who.role)) return { ok: false, error: "consent_owner_only" };
    return previewStep(who.ctx, body.value);
  }
  const body = checkImportBody(input);
  if (!body.ok) return { ok: false, error: body.error };
  if ((body.value.consent !== null || body.value.consent_confirmed) && !MAY_CONFIRM.includes(who.role)) return { ok: false, error: "consent_owner_only" };
  return importStep(who.ctx, body.value);
}

export async function runSheetLink(who: Who, input: unknown): Promise<Out<SheetLink>> {
  if (importMode() === "off") return { ok: false, error: "not_available" };
  if (!MAY_CONFIRM.includes(who.role)) return { ok: false, error: "forbidden" };
  const body = checkSheetLinkBody(input);
  return body.ok ? makeSheetLink(who.ctx, body.value) : { ok: false, error: body.error };
}

export async function runSheetLinkAct(who: Who, id: unknown, what: unknown): Promise<Out<SheetLink>> {
  if (importMode() === "off") return { ok: false, error: "not_available" };
  if (!MAY_CONFIRM.includes(who.role)) return { ok: false, error: "forbidden" };
  if (!isUuid(id) || (what !== "sync" && what !== "pause" && what !== "resume")) return { ok: false, error: "invalid" };
  return actOnLink(who.ctx, id, what);
}
