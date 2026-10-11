import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import app from "@/i18n/strings/app.json";
import { appDict, appT, frameLabels } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";
import { TRANSLATED_LANGS, dictFor } from "@/i18n/strings";
import { FORBIDDEN_CLAIMS as FORBIDDEN } from "@/i18n/strings/forbidden";
import { FOOT, NAV } from "@/components/v2/app/nav";

type Entry = { en: string; te: string; hi: string; kn: string; status: Record<string, string>; humanOnly?: boolean };
const data = app as Record<string, Entry>;
const keys = Object.keys(data);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const HUMAN_ONLY = ["agentset.mfa", "agentset.quiet.evening", "agentset.quiet.saved", "agentset.rem.note", "agentset.saved.off", "agentset.saved.on", "agentset.saved.reminders", "agentset.sched.approved", "agentset.sched.approved.no", "agentset.sched.count.failed", "agentset.sched.count.sent", "agentset.sending.off", "agentset.sending.on", "agentset.sending.switch", "agentset.sending.title", "agentset.sending.what", "agentset.system.off.note", "agentset.system.on.note", "ask.approve.hint", "ask.error", "ask.mic.privacy", "ask.noscreen", "ask.sub", "catalogue.err.price", "catalogue.err.price_owner", "catalogue.err.send.hidden", "catalogue.err.send.photo", "catalogue.field.price", "catalogue.field.price_band", "catalogue.filter.band", "catalogue.form.band.help", "catalogue.form.price.clear", "catalogue.form.price.now", "catalogue.form.price.other", "catalogue.form.price.owner", "catalogue.record.on", "catalogue.send.caption.help", "catalogue.send.intro", "catalogue.send.preview.note", "catalogue.send.template", "catalogue.send.why", "catalogue.why.auto_off", "catalogue.why.category_other", "catalogue.why.commitment", "catalogue.why.complaint", "catalogue.why.model_flagged", "catalogue.why.money", "catalogue.why.no_inbound_window", "catalogue.why.other", "catalogue.why.uncertain", "contact.call.note", "contact.intro", "contact.keep.help", "contact.record.call", "contact.record.failed", "contact.record.kept", "contact.record.later", "contact.record.off", "contact.state.blocked", "contact.state.call", "contact.state.needs", "contact.state.queued", "contact.state.queued.time", "contact.state.sent", "contact.wa.help", "contact.wa.note", "integrations.email.body", "integrations.upi.body", "integrations.upi.title", "integrations.whatsapp.body", "integrations.whatsapp.title", "lead.sent.hint", "outbox.autooff", "outbox.channel", "outbox.disclosure", "outbox.dispatch.hint", "outbox.dispatch.none", "outbox.dr.failed", "outbox.dr.held", "outbox.dr.retry", "outbox.dr.sent", "outbox.dr.stilldue", "outbox.dr.stopped", "outbox.due.line", "outbox.ev.approved", "outbox.ev.approved.noname", "outbox.ev.blocked", "outbox.ev.edited", "outbox.ev.edited.noname", "outbox.ev.failed", "outbox.ev.held", "outbox.ev.held.other", "outbox.ev.held.quiet", "outbox.ev.made.assistant", "outbox.ev.made.person", "outbox.ev.made.person.noname", "outbox.ev.made.system", "outbox.ev.needs", "outbox.ev.queued", "outbox.ev.rejected", "outbox.ev.rejected.noname", "outbox.ev.sent", "outbox.ev.sent.worker", "outbox.failure.adapter_error", "outbox.failure.rejected", "outbox.failure.timeout", "outbox.flag.commitment", "outbox.flag.complaint", "outbox.flag.money", "outbox.hist.approved", "outbox.hist.blocked", "outbox.hist.edited", "outbox.hist.failed", "outbox.hist.held", "outbox.hist.made.assistant", "outbox.hist.made.owner", "outbox.hist.made.system", "outbox.hist.rejected", "outbox.hist.sent", "outbox.hist.waiting", "outbox.reason.commitment", "outbox.reason.complaint", "outbox.reason.erased", "outbox.reason.money", "outbox.reason.no_key", "outbox.reason.no_opt_in", "outbox.reason.stopped", "outbox.sched.stale", "outbox.stopped.body", "outbox.stopped.title", "outbox.tab.count.blocked", "outbox.tab.count.scheduled", "outbox.tab.count.sent", "outbox.tab.count.waiting", "outbox.why", "settings.privacy.erasure", "settings.privacy.note", "settings.privacy.suppression", "settings.security.off", "settings.security.on", "settings.security.open", "settings.tab.agent", "settings.tab.privacy", "settings.tab.security", "setup.s4.auto", "setup.s4.quiet", "setup.s4.waits.calls", "setup.s4.waits.complaints", "setup.s4.waits.money", "setup.s4.waits.title", "today.badge.call", "today.badge.complaint", "today.badge.message", "today.badge.price", "today.badge.promise", "today.badge.visit", "today.block.daily_limit", "today.block.erased", "today.block.no_key", "today.block.no_opt_in", "today.block.no_phone", "today.block.other", "today.block.owner_rejected", "today.block.send_failed", "today.block.stopped", "today.block.switch_off", "today.edit.hint", "today.edit.label", "today.err.generic", "today.err.mfa", "today.err.role", "today.err.state", "today.err.stopped", "today.fact.amount", "today.goes", "today.hint.nothingSent", "today.kind.order", "today.needs.more", "today.needs.note", "today.notext", "today.over.none", "today.over.some", "today.owneronly", "today.toast.blocked", "today.toast.callok", "today.toast.edited", "today.toast.queued", "today.toast.queuedNow", "today.toast.rejected", "today.toast.sent", "today.toast.visit", "today.toast.visit.notsent", "today.toast.visit.sent", "today.visit.hint", "today.why", "visits.advance", "visits.book.advance", "visits.book.advance.amount", "visits.book.advance.hint", "visits.book.note", "visits.cancel.hint", "visits.complete.hint", "visits.complete.hint.sales", "visits.err.erased", "visits.err.no_quote", "visits.err.order_exists", "visits.err.order_other", "visits.err.quote_expired", "visits.err.quotes.link", "visits.move.hint", "visits.toast.booked", "visits.toast.cancelled", "visits.toast.confirmed", "visits.toast.moved", "visits.toast.order"]; // money held, amounts and what a button sends or does not: English until a person reviews them

describe("the frame's string store (language track L0)", () => {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, dictFor(app as never, l) as Record<string, string>]));
  it("has the same keys in four languages, no empty string, the same {placeholders}", () => {
    for (const lang of LANGS) {
      expect(Object.keys(dicts[lang]).sort(), lang).toEqual([...keys].sort());
      for (const k of keys) {
        expect(dicts[lang][k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(placeholders(dicts[lang][k]), `${lang}:${k}`).toEqual(placeholders(dicts.en[k]));
      }
    }
  });
  it("every non-English string is a DRAFT (nobody who reads the language has marked one reviewed)", () => {
    for (const k of keys) for (const l of TRANSLATED_LANGS) expect(data[k].status[l], `${k}:${l}`).toBe("draft");
  });
  // "Agent OWL" is a product name, kept in Latin letters in every language like WhatsApp (i18n/STYLE.md); it is not a machine-translated sentence, so it is not humanOnly either.
  const PRODUCT_NAME_KEY = "agent.main";
  it("uses each language's own script, except the strings that must stay English until a person reviews them", () => {
    const script = { te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ } as const;
    for (const l of TRANSLATED_LANGS) expect(keys.filter((k) => !data[k].humanOnly && k !== PRODUCT_NAME_KEY && !script[l].test(dicts[l][k])), l).toEqual([]);
  });
  it("the strings no machine may translate (money rules, privacy and erasure, do-not-contact) show the English in every language", () => {
    expect(keys.filter((k) => data[k].humanOnly).sort()).toEqual(HUMAN_ONLY);
    for (const k of HUMAN_ONLY) for (const l of TRANSLATED_LANGS) expect(dicts[l][k].replaceAll("\u2060", ""), `${k}:${l}`).toBe(dicts.en[k]); // the only difference allowed is the invisible word joiner after a hyphen
  });
  it("makes no claim we cannot prove, never hard-codes the brand name", () => {
    for (const l of LANGS) for (const k of keys) {
      for (const [re, label] of FORBIDDEN) expect(re.test(dicts[l][k]), `${l}:${k} contains ${label}`).toBe(false);
      expect(dicts[l][k]).not.toMatch(/sme-?ai/i);
    }
  });
  it("English parity: the English words are exactly the menu table's words", () => {
    for (const g of NAV) {
      expect(appDict("en")[`nav.group.${g.id}` as keyof typeof app], g.id).toBe(g.label);
      for (const i of g.items) expect(appDict("en")[`nav.item.${i.id}` as keyof typeof app], i.id).toBe(i.label);
    }
    for (const i of FOOT) expect(appDict("en")[`nav.item.${i.id}` as keyof typeof app], i.id).toBe(i.label);
  });
  it("fills a placeholder and ships the dictionary of ONE language as props", () => {
    expect(appT("en")("frame.aiused", { percent: 85 })).toBe("85% used");
    expect(appT("te")("frame.ailight", { time: "11 Oct, 12:00 am" })).toContain("11 Oct, 12:00 am");
    expect(Object.keys(frameLabels("te")).length).toBe(keys.length);
  });
  it("is server only: no client component imports it (all four dictionaries would land in the browser bundle)", () => {
    const WEB = path.resolve(import.meta.dirname, "..");
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));
    const clients = [...walk(path.join(WEB, "components")), ...walk(path.join(WEB, "app"))].filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).filter((f) => /^\s*["']use client["']/.test(fs.readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(10);
    for (const f of clients) expect(fs.readFileSync(f, "utf8"), path.relative(WEB, f)).not.toMatch(/@\/i18n\/(app|auth|landing)"|@\/i18n\/strings\/app\.json/);
  });
});
