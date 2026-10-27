import { ApiAuthError } from "@/lib/api/client";
import { listOutboxMessages } from "@/lib/api/outbox";
import { getTodayVisits } from "@/lib/api/visits";
import type { NeedsYouItem } from "@/lib/api/today";
import { MAX_NOTICES, isNoticeCode, kindOf, type Notice, type NoticeCode } from "@/lib/notifications/model";

import { readProposals } from "../today-visits";
import { readTodayCached } from "../today-read";

type Role = "owner" | "admin" | "sales" | "viewer";

/** Blocked messages are news for a day, then history. */
const BLOCKED_WINDOW_MS = 24 * 3600 * 1000;

function hrefOfNeeds(base: string, item: NeedsYouItem): string {
  switch (item.target.type) {
    case "order":
      return `${base}/orders/${item.target.id}`;
    case "lead":
      return `${base}/leads/${item.target.id}`;
    case "enquiry":
      return `${base}/enquiries/${item.target.id}`;
    case "quote":
      return `${base}/quotes`; // a quote has no page of its own and finding its enquiry costs a call: the list is one tap away
    default:
      return `${base}#needs-you`; // a message or a call is decided on Today itself
  }
}

/**
 * The notices of one person in one workspace (job BU), made from what the app already reads with that person's own token: Today's "needs you" (the database decides what each role is given), the visits Agent OWL
 * proposed, a customer who is at the shop now, and the messages the Outbox blocked in the last day (people who may use the Outbox). Each part is read on its own: one that fails is simply left out (the bell never
 * invents a notice); a rejected session is passed on. Nothing here is stored, and no words of a customer's message are copied: only the customer's name, a closed code and a time.
 */
export async function readNotices(accessToken: string, tenantId: string, role: Role, now: number = Date.now()): Promise<Notice[]> {
  const base = `/app/tenants/${tenantId}`;
  const [today, proposals, visits, blocked] = await Promise.allSettled([
    readTodayCached(accessToken, tenantId),
    role === "viewer" ? Promise.resolve([]) : readProposals(accessToken, tenantId, now),
    getTodayVisits(accessToken, tenantId),
    role === "viewer" ? Promise.resolve(null) : listOutboxMessages(accessToken, tenantId, { limit: 5, tab: "blocked" }),
  ]);
  for (const r of [today, proposals, visits, blocked]) if (r.status === "rejected" && r.reason instanceof ApiAuthError) throw r.reason;

  const out: Notice[] = [];
  const push = (id: string, code: NoticeCode, who: string, at: string, href: string) => out.push({ id, kind: kindOf(code), code, who, at, href });
  if (today.status === "fulfilled") {
    // the bell has a sentence for the kinds of the shop's Today; a hot lead or a calling limit (Lead Desk) is on Today itself and is not announced here (yet)
    for (const i of today.value.needs_you) if (isNoticeCode(i.kind)) push(`${i.kind}:${i.id}`, i.kind, i.customer, i.at, hrefOfNeeds(base, i));
  }
  if (proposals.status === "fulfilled") {
    for (const c of proposals.value) if (c.type === "visit") push(`visit_proposed:${c.id}`, "visit_proposed", c.visit.customer ?? c.visit.who, c.at, `${base}/visits?visit=${c.id}`);
  }
  if (visits.status === "fulfilled") {
    for (const v of visits.value.items) if (v.visit_status === "arrived") push(`visit_here:${v.id}`, "visit_here", v.who, v.starts_at, `${base}/visits?visit=${v.id}`);
  }
  if (blocked.status === "fulfilled" && blocked.value) {
    for (const m of blocked.value.items) {
      const at = m.decided_at ?? m.created_at;
      if (now - Date.parse(at) <= BLOCKED_WINDOW_MS) push(`message_blocked:${m.id}`, "message_blocked", m.customer ?? "", at, `${base}/outbox?tab=blocked`);
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_NOTICES);
}
