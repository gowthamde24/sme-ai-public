import { redirect } from "next/navigation";

/** The old address of My AI team (sidebar v2 moved it to /ai-team, owner rule 6 Nov): a bookmark or an old link still arrives, with its ?agent= kept. The menu itself never comes through here. */
export default async function OfficeRedirect({ params, searchParams }: PageProps<"/app/tenants/[tenantId]/office">): Promise<never> {
  const { tenantId } = await params;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  const s = q.toString();
  redirect(`/app/tenants/${tenantId}/ai-team${s ? `?${s}` : ""}`);
}
