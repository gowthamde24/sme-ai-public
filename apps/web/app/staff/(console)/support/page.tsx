import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InlineScreen } from "@/components/v2/app/staff/PlainScreens";
import { SupportInbox, isInboxStatus } from "@/components/v2/app/staff/SupportInbox";
import { Topbar } from "@/components/v2/app/staff/Topbar";
import { loadStaff, staffSource } from "@/lib/staff/load";
import { SUP, TEXT } from "@/lib/staff/words";

export const metadata: Metadata = { title: "Support · Staff console · Stack19" };
export const dynamic = "force-dynamic";

/** Staff console, Support inbox (owner and support): the tickets by status (`?status=active|open|waiting|closed`, Active by default), urgent first, the longest waiting first. Finance sees one plain sentence (the API says 403 for that role). */
export default async function SupportPage({ searchParams }: PageProps<"/staff/support">) {
  const state = await loadStaff();
  if (!state.ok) return null; // the layout drew the reason
  const { keep, overview } = state.data;
  const raw = (await searchParams).status;
  const status = isInboxStatus(raw) ? raw : "active";
  const { source } = await staffSource();
  const list = await source.tickets(status);
  if (!list.ok) {
    if (list.failure === "signed_out") redirect("/staff/signed-out");
    if (list.failure === "no_access") return <InlineScreen title={SUP.notForRole} body={SUP.notForRoleBody} keep={keep} />;
    return <InlineScreen title={TEXT.unavailableTitle} body={TEXT.unavailableBody} keep={keep} />;
  }
  return (
    <>
      <Topbar title={SUP.inboxTitle} envLabel={overview.environment.label} generatedAt={overview.generatedAt} />
      <SupportInbox list={list.data} status={status} keep={keep} />
    </>
  );
}
