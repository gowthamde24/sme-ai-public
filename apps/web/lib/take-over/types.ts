/**
 * The business's switch for live take-over (job 1, C1's `GET/PUT /v1/tenants/{id}/calls/take-over-setting`): ONE switch, owned by the Owner, OFF until the Owner turns it on. When it is on, an Owner or Admin can listen to the
 * caller and speak to them from the app during a live call. Nothing is recorded; every change and every session is in the audit log. `announces`: the deployment tells the caller a team member is joining (a platform flag).
 * The lawyer's answer that this is allowed was verbal and is not yet confirmed in writing. Anything the API sends beyond this is ignored.
 */
export type TakeOver = { enabled: boolean; changedAt: string | null; announces: boolean };
export type TakeOverError = "forbidden" | "not_available" | "down";

export function parseTakeOver(json: unknown): TakeOver | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  if (typeof j.enabled !== "boolean") return null;
  return { enabled: j.enabled, changedAt: typeof j.updated_at === "string" ? j.updated_at.slice(0, 40) : null, announces: j.announces === true };
}
