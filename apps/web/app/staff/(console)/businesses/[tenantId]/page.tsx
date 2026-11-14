import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InlineScreen } from "@/components/v2/app/staff/PlainScreens";
import { SupportViewBody } from "@/components/v2/app/staff/SupportViewBody";
import { Topbar } from "@/components/v2/app/staff/Topbar";
import { loadStaff, staffSource } from "@/lib/staff/load";
import { TEXT } from "@/lib/staff/words";

export const metadata: Metadata = { title: "Support view · Staff console · Stack19" };
export const dynamic = "force-dynamic";

/**
 * The read-only support view of one business. It is reached only through the reason box (`POST /v1/admin/access`, then `?access=<access_id>`): without a valid access the API says 403 access_required and this page says to open the business from the Overview.
 * 409 owner_ok_required (the business wants its owner's OK first) has its own plain sentence. Never an edit control.
 */
export default async function SupportViewPage({ params, searchParams }: PageProps<"/staff/businesses/[tenantId]">) {
  const state = await loadStaff();
  if (!state.ok) return null; // the layout drew the reason
  const { tenantId } = await params;
  const access = (await searchParams).access;
  const { keep, overview } = state.data;
  const accessId = typeof access === "string" && access.length > 0 && access.length <= 80 ? access : null;
  if (!accessId) return <InlineScreen title={TEXT.accessRequiredTitle} body={TEXT.accessRequiredBody} keep={keep} />;
  const { source } = await staffSource();
  const view = await source.view(tenantId, accessId);
  if (!view.ok) {
    if (view.failure === "signed_out") redirect("/staff/signed-out");
    if (view.failure === "owner_ok_required") return <InlineScreen title={TEXT.ownerOkTitle} body={TEXT.ownerOkBody} keep={keep} />;
    if (view.failure === "no_access") return <InlineScreen title={TEXT.noAccessTitle} body={TEXT.noAccessBody} keep={keep} />;
    if (view.failure === "access_required") return <InlineScreen title={TEXT.accessRequiredTitle} body={TEXT.accessRequiredBody} keep={keep} />;
    return <InlineScreen title={TEXT.unavailableTitle} body={TEXT.unavailableBody} keep={keep} />;
  }
  return (
    <>
      <Topbar title={view.data.business?.name ?? view.data.setup.businessName} envLabel={overview.environment.label} generatedAt={overview.generatedAt} />
      <SupportViewBody view={view.data} keep={keep} tenantId={tenantId} accessId={accessId} role={state.data.me.role} />
    </>
  );
}
