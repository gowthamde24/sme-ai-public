import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BusinessesTable } from "@/components/v2/app/staff/BusinessesTable";
import { InlineScreen } from "@/components/v2/app/staff/PlainScreens";
import { Topbar } from "@/components/v2/app/staff/Topbar";
import { loadStaff, staffSource } from "@/lib/staff/load";
import { SUP, TEXT } from "@/lib/staff/words";

export const metadata: Metadata = { title: "Businesses · Staff console · Stack19" };
export const dynamic = "force-dynamic";

/** Staff console, Businesses (every staff role): the list with a search (`?q=`: part of a name, a town or a tenant id), newest activity first. No customer data: "View" asks for a reason first. */
export default async function BusinessesPage({ searchParams }: PageProps<"/staff/businesses">) {
  const state = await loadStaff();
  if (!state.ok) return null; // the layout drew the reason
  const { keep, overview, me } = state.data;
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
  const { source, mock, role } = await staffSource();
  const list = await source.businesses(q, null);
  if (!list.ok) {
    if (list.failure === "signed_out") redirect("/staff/signed-out");
    return <InlineScreen title={TEXT.unavailableTitle} body={TEXT.unavailableBody} keep={keep} />;
  }
  return (
    <>
      <Topbar title={SUP.businessesTitle} envLabel={overview.environment.label} generatedAt={overview.generatedAt} />
      <BusinessesTable list={list.data} q={q} role={me.role} nowIso={overview.generatedAt} keepRole={mock && role !== "owner" ? role : ""} />
    </>
  );
}
