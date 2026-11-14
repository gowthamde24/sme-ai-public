import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { InlineScreen } from "@/components/v2/app/staff/PlainScreens";
import { TicketThreadView } from "@/components/v2/app/staff/TicketThreadView";
import { Topbar } from "@/components/v2/app/staff/Topbar";
import { loadStaff, staffSource } from "@/lib/staff/load";
import { SUP, TEXT } from "@/lib/staff/words";

export const metadata: Metadata = { title: "Ticket · Staff console · Stack19" };
export const dynamic = "force-dynamic";

/** Staff console, one support ticket (owner and support): the messages, reply or internal note, status, assignee. Reading it is audited by the API. An unknown ticket says so in words; finance sees the "not for your role" sentence. */
export default async function TicketPage({ params }: PageProps<"/staff/support/[ticketId]">) {
  const state = await loadStaff();
  if (!state.ok) return null; // the layout drew the reason
  const { ticketId } = await params;
  const { keep, overview, me } = state.data;
  const { source } = await staffSource();
  const thread = await source.thread(ticketId);
  if (!thread.ok) {
    if (thread.failure === "signed_out") redirect("/staff/signed-out");
    if (thread.failure === "no_access") return <InlineScreen title={SUP.notForRole} body={SUP.notForRoleBody} keep={keep} />;
    if (thread.failure === "not_found") return <InlineScreen title={SUP.notFound} body={SUP.inboxNone} keep={keep} />;
    return <InlineScreen title={TEXT.unavailableTitle} body={TEXT.unavailableBody} keep={keep} />;
  }
  return (
    <>
      <Topbar title={thread.data.businessName} envLabel={overview.environment.label} generatedAt={overview.generatedAt} />
      <div><Link className="sc-back" href={`/staff/support${keep}`}>{SUP.back}</Link></div>
      <TicketThreadView initial={thread.data} myStaffId={me.staffId} />
    </>
  );
}
