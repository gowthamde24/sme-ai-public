"use client";

import { BellOff, CalendarCheck, CircleSlash, FileText, MessageSquare, Phone, RefreshCw, ReceiptIndianRupee, UserRound, X } from "lucide-react";
import Link from "next/link";
import type { RefObject } from "react";
import { createPortal } from "react-dom";

import { OrbMark } from "@/components/v2/app/mark/OrbMark";
import type { Notice, NoticeCode } from "@/lib/notifications/model";

import { word, type Labels } from "../labels";
import { ago } from "../today/time";

const ICON: Record<NoticeCode, typeof FileText> = {
  quote_approval: FileText,
  followup_due: MessageSquare,
  order_money_held: ReceiptIndianRupee,
  outbox_approval: MessageSquare,
  call_approval: Phone,
  visit_proposed: CalendarCheck,
  visit_here: UserRound,
  message_blocked: CircleSlash,
};
const ENGLISH: Record<NoticeCode, string> = {
  quote_approval: "A quote waits for you",
  followup_due: "A follow-up is due",
  order_money_held: "Money is held on an order",
  outbox_approval: "A message waits for your OK",
  call_approval: "A call waits for your OK",
  visit_proposed: "A visit waits for you to confirm",
  visit_here: "A customer is at the shop",
  message_blocked: "A message was blocked",
};

type Permission = "unsupported" | "default" | "granted" | "denied";

/**
 * The panel of the bell (the list of notices and the browser-notification switch). It is its own file so that the bell's button, which every page carries, does not bring the panel's code with it: the bell loads it (next/dynamic)
 * the first time the person opens the panel.
 */
export default function NotificationPanel({ host, panelRef, id, labels, onClose, status, items, opened, permission, browserOn, turnOn, turnOff }: {
  host: Element;
  panelRef: RefObject<HTMLDivElement | null>;
  id: string;
  labels?: Labels;
  onClose: () => void;
  status: string;
  items: readonly Notice[];
  opened: readonly string[];
  permission: Permission;
  browserOn: boolean;
  turnOn: () => Promise<void>;
  turnOff: () => void;
}) {
  return createPortal(
            <div
              ref={panelRef}
              id={id}
              role="region"
              aria-label={word(labels, "notify.title", "Notifications")}
              data-notify="panel"
              className="fixed inset-x-3 top-[4.25rem] z-[60] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-ink shadow-[var(--v2-shadow-pop)] md:inset-x-auto md:right-8 md:w-[26rem]"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">{word(labels, "notify.title", "Notifications")}</h2>
                <button type="button" onClick={onClose} aria-label={word(labels, "notify.close", "Close")} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2">
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              {status === "error" ? (
                <p role="status" className="mt-2 flex items-start gap-2 rounded-xl bg-amber-bg px-3 py-2 text-sm text-amber-text">
                  <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {word(labels, "notify.error", "Could not check just now. Trying again soon.")}
                </p>
              ) : null}
              {status === "signed_out" ? (
                <p role="status" className="mt-2 rounded-xl bg-amber-bg px-3 py-2 text-sm text-amber-text">
                  {word(labels, "notify.signedout", "Your session has ended. Reload the page to sign in again.")}
                </p>
              ) : null}
              {items.length === 0 ? (
                <div className="mt-3 flex items-center gap-3">
                  <OrbMark px={56} mood={"resting"} className="size-14 shrink-0" />
                  <p className="text-base text-muted">{status === "loading" ? word(labels, "notify.loading", "Checking…") : word(labels, "notify.empty", "Nothing needs you right now.")}</p>
                </div>
              ) : (
                <ul className="mt-2 flex flex-col divide-y divide-line">
                  {items.map((n) => {
                    const Icon = ICON[n.code];
                    const isNew = opened.includes(n.id);
                    return (
                      <li key={n.id}>
                        <Link href={n.href} onClick={onClose} data-notice={n.code} className="flex min-h-14 items-start gap-3 rounded-lg px-1 py-3 hover:bg-surface-2">
                          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-brand-bg text-brand-text" aria-hidden="true">
                            <Icon className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-medium">{word(labels, `notify.code.${n.code}`, ENGLISH[n.code])}</span>
                            {n.who ? <span className="block truncate text-sm text-muted">{n.who}</span> : null}
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1 text-sm text-muted">
                            <span>{ago(n.at)}</span>
                            {isNew ? <span className="rounded-full border border-brand-edge bg-brand-bg px-2 text-sm font-semibold text-brand-text">{word(labels, "notify.new", "New")}</span> : null}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <section aria-labelledby={`${id}-browser`} className="mt-3 border-t border-line pt-3">
                <h3 id={`${id}-browser`} className="text-base font-semibold">
                  {word(labels, "notify.browser.title", "Browser notifications")}
                </h3>
                <p className="mt-1 text-sm text-muted">{word(labels, "notify.browser.hint", "A pop-up in this browser when something needs you. It says only how many, never a name.")}</p>
                {permission === "unsupported" ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                    <BellOff className="size-4" aria-hidden="true" />
                    {word(labels, "notify.browser.unsupported", "This browser cannot show them.")}
                  </p>
                ) : permission === "denied" ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted">
                    <BellOff className="size-4" aria-hidden="true" />
                    {word(labels, "notify.browser.denied", "They are blocked in this browser. Change it in the browser's site settings.")}
                  </p>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={browserOn}
                    onClick={() => void (browserOn ? turnOff() : turnOn())}
                    className="mt-2 inline-flex min-h-11 items-center gap-3 rounded-lg pr-2 text-base"
                  >
                    <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border ${browserOn ? "border-brand-edge bg-brand" : "border-edge bg-surface-2"}`}>
                      <span className={`absolute size-4 rounded-full shadow ${browserOn ? "left-6 bg-on-brand" : "left-1 bg-muted"}`} />
                    </span>
                    {browserOn ? word(labels, "notify.browser.on", "On") : word(labels, "notify.browser.off", "Off")}
                  </button>
                )}
              </section>
            </div>,
    host,
  );
}
