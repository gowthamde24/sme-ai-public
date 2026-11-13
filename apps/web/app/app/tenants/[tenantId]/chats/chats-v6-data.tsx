import { ChatsV6 } from "@/components/v2/app/chats/v6/ChatsV6";
import { helpTipFor } from "@/components/v2/app/help/help-tip";
import { wordsFor } from "@/i18n/app-words";
import { getLang } from "@/i18n/get-lang";
import { isCanonicalUuid } from "@/lib/api/crm";
import { fetchCustomerHead, fetchTimeline } from "@/lib/api/customer-timeline";
import { listOutboxApprovals, type OutboxMessage } from "@/lib/api/outbox";
import { settle } from "@/lib/api/part";
import { getThread, listConversations } from "@/lib/api/whatsapp";
import { readOffList, switchOn } from "@/lib/chats/assistant-switch";
import { assistantOn, parseChatFilter } from "@/lib/chats/handling";
import { leadTitle } from "@/lib/lead-desk/leads";
import { teachScreens } from "@/lib/screens/flag";

import { approveCallQuoteAction } from "../calls/v6-actions";
import { sourceWords } from "../customers/[leadId]/customer-logic";
import { approveFromOutboxAction, editFromOutboxAction, rejectFromOutboxAction } from "../outbox/outbox-actions";
import { teachAction, undoTeachAction } from "../teach-actions";
import { markReadAction, replyAction } from "./actions";
import { setChatAssistantAction } from "./v6-actions";

/** The moment the page is drawn (ms), read once, so every "3h" on it agrees. */
const clock = (): number => Date.now();
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const clean = (v: string | string[] | undefined): string => (first(v) ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
const BEFORE = /^\d{4}-\d{2}-\d{2}T[0-9:.+Z-]{4,40}$/;

/**
 * The Chats page of design system v6 (DESIGN_V6), for /chats and /chats/[leadId] alike: the chats the API sent, the replies waiting for the owner's OK (the outbox's approvals, Owner and Admin), and for the open chat its thread, its customer and the customer's timeline. The role is the one the
 * page already read (Owner, Admin, Sales). Owner and Admin send, edit and decline the waiting reply and may flip the assistant; Sales reads and writes their own replies. A part that cannot be read says so in its place and the rest still draws. Nothing is sent from here by itself.
 */
export async function ChatsV6Page(o: { token: string; tenantId: string; role: string; leadId: string | null; searchParams: Record<string, string | string[] | undefined> }) {
  const { token, tenantId, role } = o;
  const lang = await getLang();
  const base = `/app/tenants/${tenantId}`;
  const filter = parseChatFilter(o.searchParams.filter);
  const q = clean(o.searchParams.q);
  const rawBefore = first(o.searchParams.before);
  const before = rawBefore && BEFORE.test(rawBefore) ? rawBefore : null;
  const asked = o.leadId && isCanonicalUuid(o.leadId) ? o.leadId : null;
  const decider = role === "owner" || role === "admin";

  const [list, approvals, off] = await Promise.all([settle(() => listConversations(token, tenantId, { limit: 50, before })), decider ? settle(() => listOutboxApprovals(token, tenantId, { limit: 50 })) : Promise.resolve(null), readOffList()]);
  const waitingBy = new Map<string, OutboxMessage>();
  if (approvals?.ok)
    for (const m of approvals.data.items)
      if (m.status === "needs_approval") {
        const seen = waitingBy.get(m.lead_id);
        if (!seen || seen.created_at < m.created_at) waitingBy.set(m.lead_id, m);
      }

  const words = wordsFor(lang, ["chats6.", "wa.", "outbox.reason.", "outbox.flag.", "apierr.", "dst.teach", "calls6.quote.", "today.err.", "today.lang.", "catalogue.thumb.", "catalogue.photo.", "outcome.cat.", "ld.source."], ["dta.btn.working"]);
  const now = clock();
  const teach = decider && teachScreens() !== "off" ? { save: teachAction.bind(null, tenantId), undo: undoTeachAction.bind(null, tenantId) } : null;
  const approve = decider ? approveCallQuoteAction.bind(null, tenantId) : null;

  // on /chats with no chat chosen, a wide screen still shows THREE columns: the first chat that has a reply waiting for the owner (else the first one) is shown beside the list; a phone keeps showing the list (`defaultOpen`)
  const first_ = list.ok ? list.data.conversations : [];
  const preferred = asked === null ? (first_.find((c) => waitingBy.has(c.lead_id)) ?? first_[0])?.lead_id ?? null : null;
  const leadId = asked ?? preferred;
  let conversation = null;
  let customer = null;
  if (leadId) {
    const [thread, head, timeline] = await Promise.all([settle(() => getThread(token, tenantId, leadId)), settle(() => fetchCustomerHead(token, tenantId, leadId)), settle(() => fetchTimeline(token, tenantId, leadId, null, 20))]);
    const row = list.ok ? list.data.conversations.find((c) => c.lead_id === leadId) : undefined;
    const name = leadTitle(thread.ok ? (thread.data.display_name ?? thread.data.name) : (row?.display_name ?? row?.name), null, words["wa.chats.customer"] ?? "");
    const w = waitingBy.get(leadId);
    const switchState = !switchOn() ? ("hidden" as const) : decider ? ("free" as const) : ("locked" as const);
    if (thread.ok)
      conversation = {
        autoRead: asked !== null,
        leadId,
        name,
        thread: thread.data,
        waiting: w
          ? { id: w.id, text: w.text, language: w.language, media: w.media.map((m) => ({ position: m.position, thumb_url: m.thumb_url })), reasons: [...w.flags.map((f) => words[`outbox.flag.${f}`]), words[`outbox.reason.${w.reason}`]].filter((x): x is string => !!x) }
          : null,
        canDecide: decider,
        canReply: decider || role === "sales",
        assistantOn: assistantOn(thread.data.assistantEnabled ?? row?.assistantEnabled, off, leadId),
        switchState,
        teach,
        actions: {
          reply: replyAction.bind(null, tenantId, leadId),
          markRead: markReadAction.bind(null, tenantId, leadId),
          approve: approveFromOutboxAction.bind(null, tenantId),
          reject: rejectFromOutboxAction.bind(null, tenantId),
          edit: editFromOutboxAction.bind(null, tenantId),
          setAssistant: switchState === "free" ? setChatAssistantAction.bind(null, tenantId, leadId) : null,
        },
      };
    customer = { leadId, name, head: head.ok ? head.data : null, timeline: timeline.ok ? timeline.data.items : null, source: head.ok ? sourceWords(head.data.source, words) : null, approve };
  }
  const query = new URLSearchParams();
  if (filter !== "all") query.set("filter", filter);
  if (q) query.set("q", q);
  const olderHref = list.ok && list.data.next_before ? `${base}/chats?${new URLSearchParams([...query, ["before", list.data.next_before]])}` : null;
  return (
    <ChatsV6
      words={words}
      lang={lang}
      base={base}
      filter={filter}
      q={q}
      chats={list.ok ? list.data.conversations.filter((c) => !q || `${c.display_name ?? c.name ?? ""} ${c.company ?? ""} ${c.preview}`.toLowerCase().includes(q.toLowerCase())) : null}
      waiting={new Set(waitingBy.keys())}
      now={now}
      olderHref={olderHref}
      selectedId={leadId}
      defaultOpen={asked === null && leadId !== null}
      card={first(o.searchParams.card) === "1"}
      conversation={conversation}
      customer={customer}
      help={helpTipFor(lang, base, "chats", true)}
      connectHref={`${base}/integrations/whatsapp`}
    />
  );
}
