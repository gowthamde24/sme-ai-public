import type { TodayWords } from "./today-words";

/**
 * The keys of the words Today's client parts need, resolved by the SERVER in the person's language and handed down as props (`todayWords`). Kept apart from ./today-words.ts (`say`), which every client part imports: a module the
 * browser loads keeps every export another route uses, so this list lives where only the server (and the demo video's own chunk) reads it.
 */
export const TODAY_WORD_KEYS = [
  // the short words of the one-line rows on a desktop (the owner's target: "Call", "Quote", "Approve", "Store visit")
  "today.badge.call.row", "today.badge.price.row", "today.badge.promise.row", "today.badge.complaint.row", "today.badge.message.row", "today.badge.visit.row", "today.kind.quote.row", "today.kind.followup.row", "today.kind.order.row", "today.kind.hot.row", "today.kind.plan.row", "today.kind.callback.row", "today.kind.cap.row", "today.act.approve.row", "today.act.callok.row", "today.act.visit.row", "today.act.vconfirm.row", "today.step.quote.row", "today.step.followup.row", "today.step.order.row", "today.step.hot.row", "today.step.plan.row", "today.step.callback.row", "today.step.cap.row", "today.kind.prospect.row", "today.step.prospect.row", "today.kind.prospect", "today.step.prospect", "today.prospect.needsok", "lf.act.call", "lf.act.skip", "today.sum.price", "today.sum.promise", "today.sum.complaint", "today.sum.reply_to_inbound", "today.sum.info", "today.sum.visit", "today.sum.followup", "today.sum.order_status", "today.sum.other", "today.topic.price", "today.topic.visit", "today.topic.quote", "today.topic.stock", "today.topic.order", "today.topic.delivery", "today.topic.and",
  "today.needsYou", "today.team", "today.state.draft", "today.kind.quote", "today.kind.followup", "today.step.quote", "today.kind.campaign", "today.kind.campaign.row", "today.step.campaign", "today.step.campaign.row", "today.kind.fees", "today.kind.fees.row", "today.step.fees", "today.step.fees.row", "today.kind.voice", "today.kind.voice.row", "today.step.voice", "today.step.voice.row", "today.fact.campaign", "today.fact.what", "today.step.followup", "today.step.order",
  "today.fact.customer", "today.fact.city", "today.fact.when", "today.fact.amount", "today.kind.order", "today.kind.hot", "today.kind.plan", "today.kind.callback", "today.kind.cap", "today.step.hot", "today.step.plan", "today.step.callback", "today.step.cap", "today.fact.plan", "today.hint.nothingSent", "today.usage.title",
  "today.usage.left", "today.usage.aria", "today.hero.one", "today.hero.other", "today.hero.none", "today.over.some", "today.over.none", "today.over.notyet",
  "today.needs.count", "today.needs.more", "today.seeall", "today.seeless", "today.row.details", "today.row.less", "today.empty", "today.badge.price", "today.badge.promise",
  // a caller who asked for a person (C1 #347)
  "today.badge.person", "today.badge.person.row", "today.title.person", "today.person.hint", "today.act.callback", "today.act.handled", "today.act.handled.row",
  // a caller who agreed a visit time (C1 #354)
  "today.title.visitcall", "today.title.visitcall.notime", "today.visitcall.hint", "today.act.book",
  "today.badge.complaint", "today.badge.message", "today.badge.call", "today.title.reply_to_inbound", "today.title.info", "today.title.visit", "today.title.followup",
  "today.title.order_status", "today.title.other", "today.title.call", "today.customer.unknown", "today.customer.new", "today.goes", "today.why", "today.lang.en", "today.lang.te",
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
  "frame.aipausednow", "today.badge.visit", "today.title.visit.proposed", "today.visit.when", "today.visit.party", "today.visit.purpose", "today.visit.hint", "today.act.vconfirm", "today.act.vchange",
  "today.act.vcancel", "visits.party.one", "visits.party.other", "visits.act.move", "visits.slot.day", "visits.slot.time", "visits.slot.pickday", "visits.slot.loading", "visits.slot.error",
  "visits.slot.free", "visits.slot.full", "visits.closed.date", "visits.closed.past", "visits.closed.weekday", "visits.closed.other", "outbox.stopped.title", "outbox.stopped.demo", "outbox.stopped.body", "outbox.gloss", "catalogue.thumb.alt", "catalogue.photo.none", "catalogue.photo.error",
] as const;

/** The words of the client parts, from the server's `t`. */
export function todayWords(t: (key: string) => string): TodayWords {
  return Object.fromEntries(TODAY_WORD_KEYS.map((k) => [k, t(k)]));
}
