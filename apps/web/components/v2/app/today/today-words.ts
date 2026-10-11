/**
 * The words the client parts of Today need (the cards, the Agent OWL card, the usage card, "Done while you slept"). Like the Ask box's words they live in a file of their own and are resolved by
 * the server in the person's language and handed down as props: a client component must not import the dictionaries (all four would land in the browser bundle). A placeholder such as {n} is
 * left in the text and filled here, by `say`.
 */
export const TODAY_WORD_KEYS = [
  "today.needsYou", "today.team", "today.state.draft", "today.kind.quote", "today.kind.followup", "today.step.quote", "today.step.followup", "today.step.order",
  "today.fact.customer", "today.fact.city", "today.fact.when", "today.fact.amount", "today.kind.order", "today.hint.nothingSent", "today.usage.title",
  "today.usage.left", "today.usage.aria", "today.hero.one", "today.hero.other", "today.hero.none", "today.over.some", "today.over.none", "today.over.notyet",
  "today.needs.note", "today.needs.count", "today.needs.more", "today.seeall", "today.seeless", "today.empty", "today.badge.price", "today.badge.promise",
  "today.badge.complaint", "today.badge.message", "today.badge.call", "today.title.reply_to_inbound", "today.title.info", "today.title.visit", "today.title.followup",
  "today.title.order_status", "today.title.other", "today.title.call", "today.customer.unknown", "today.goes", "today.why", "today.lang.en", "today.lang.te",
  "today.lang.hi", "today.lang.kn", "today.lang.ta", "today.act.approve", "today.act.edit", "today.act.notnow", "today.act.save", "today.act.cancel", "today.act.callok",
  "today.act.visit", "today.act.working", "today.edit.label", "today.edit.hint", "today.notext", "today.owneronly", "today.toast.sent", "today.toast.queued",
  "today.toast.queuedNow", "today.toast.blocked", "today.toast.rejected", "today.toast.edited", "today.toast.callok", "today.toast.visit", "today.err.mfa",
  "today.err.mfa.link", "today.err.state", "today.err.role", "today.err.stopped", "today.err.generic", "today.err.short", "today.block.switch_off",
  "today.block.stopped", "today.block.erased", "today.block.no_phone", "today.block.no_key", "today.block.no_opt_in", "today.block.daily_limit",
  "today.block.send_failed", "today.block.owner_rejected", "today.block.other", "today.visits.title", "today.visits.one", "today.visits.other", "today.visits.confirmed",
  "today.visits.reminder", "today.visits.requested", "today.visits.cal", "today.done.title", "today.done.reply_to_inbound.one", "today.done.reply_to_inbound.other",
  "today.done.info.one", "today.done.info.other", "today.done.visit.one", "today.done.visit.other", "today.done.followup.one", "today.done.followup.other",
  "today.done.order_status.one", "today.done.order_status.other", "today.done.other.one", "today.done.other.other", "today.done.quiet.one", "today.done.quiet.other",
  "today.done.empty", "today.done.link", "today.team.open", "agent.main", "agent.lead_finder", "agent.researcher", "agent.requirement_analyst", "agent.quote_writer",
  "agent.followup_desk", "agent.order_desk", "owl.mood.idle", "owl.mood.listening", "owl.mood.thinking", "owl.mood.answering", "owl.mood.resting", "common.open",
  "frame.notyet", "office.working", "office.idle", "office.switchedoff", "nav.item.office", "nav.item.settings", "ask.hero.note", "frame.ailight", "frame.aipaused",
  "frame.aipausednow",
] as const;
export type TodayWords = Readonly<Record<string, string>>;

/** The words of the client parts, from the server's `t`. */
export function todayWords(t: (key: string) => string): TodayWords {
  return Object.fromEntries(TODAY_WORD_KEYS.map((k) => [k, t(k)]));
}

/** One word of a client part, with its {placeholders} filled. A key the server did not send shows as itself, so a missing word is noticed. */
export function say(words: TodayWords, key: string, vars?: Record<string, string | number>): string {
  const text = words[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}
