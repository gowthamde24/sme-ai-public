import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { officeToJobs } from "@/lib/jobs/redirect";

/** The old address of My AI team (sidebar v2 moved it to /ai-team, owner rule 6 Nov): a bookmark or an old link still arrives, with its ?agent= kept. The menu itself never comes through here. */
export default async function OfficeRedirect({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/office">): Promise<never> {
  const { tenantId } = await params;
  await officeToJobs((await requireUser()).accessToken, tenantId); // JOBS on: Office is the Jobs page (lib/jobs/redirect.ts); off: nothing changes
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  const s = q.toString();
  redirect(`/app/tenants/${tenantId}/ai-team${s ? `?${s}` : ""}`);
}
