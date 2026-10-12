"use client";

import { Bell, BellOff, CalendarCheck, CircleSlash, FileText, MessageSquare, Phone, RefreshCw, ReceiptIndianRupee, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { OwlSvg } from "@/components/v2/app/owl/OwlSvg";
import { markAllSeen, parseSeen, toAnnounce, unreadOf, type Notice, type NoticeCode } from "@/lib/notifications/model";

import { announcedIds, browserOptInRaw, seenRaw, setBrowserOptIn, subscribeDevice, writeAnnounced, writeSeen } from "./device";
import { useNotifications } from "./use-notifications";
import { word, type Labels } from "../labels";
import { ago } from "../today/time";

const ICON: Record<NoticeCode, typeof Bell> = {
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
const permissionNow = (): Permission => (typeof Notification === "undefined" ? "unsupported" : (Notification.permission as Permission));
const noSub = () => () => undefined;

/**
 * The bell in the top bar (job BU): a count of what is new on this device, and a panel with the notices (what needs you, a customer at the shop, a blocked message), each a link to the page that decides it.
 * Data: a poll of the workspace's own notifications route, paused while the tab is hidden (see use-notifications.ts). "New" is per device (device.ts). Browser notifications are OFF until the person turns them on
 * in the panel and allows them in the browser; they speak only of "needs you" and only as a count, never a name; with no push service (it needs an API we do not have) they work while a tab of the app is open.
 */
export function NotificationBell({ tenantId, labels }: { tenantId: string; labels?: Labels }) {
  const pathname = usePathname();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [opened, setOpened] = useState<readonly string[]>([]); // the ids that were new when the panel opened: still marked "New" while it is open
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const seen = useSyncExternalStore(subscribeDevice, () => seenRaw(tenantId), () => null);
  const optIn = useSyncExternalStore(subscribeDevice, () => browserOptInRaw(), () => null) === "on";
  const permission = useSyncExternalStore(noSub, permissionNow, (): Permission => "default");

  const announce = useCallback(
    (list: Notice[]) => {
      if (!optIn || permission !== "granted" || document.visibilityState !== "hidden") return;
      const known = announcedIds(tenantId);
      const fresh = toAnnounce(list, known);
      if (fresh.length === 0) return;
      writeAnnounced(tenantId, [...known, ...fresh.map((n) => n.id)].slice(-300));
      const body = fresh.length === 1 ? word(labels, "notify.pop.one", "1 thing needs you.") : word(labels, "notify.pop.other", "{n} things need you.", { n: fresh.length });
      try {
        const n = new Notification(word(labels, "notify.pop.title", "Agent OWL"), { body, tag: `sme-needs-you:${tenantId}` });
        n.onclick = () => {
          window.focus();
          router.push(`/app/tenants/${tenantId}#needs-you`);
          n.close();
        };
      } catch {
        // some phones refuse the Notification constructor: the bell still works
      }
    },
    [optIn, permission, tenantId, labels, router],
  );
  const { items, status, refresh } = useNotifications(tenantId, optIn && permission === "granted", announce);

  const seenList = useMemo(() => parseSeen(seen), [seen]);
  const unread = unreadOf(items, seenList);
  const count = unread.length;

  // a new page closes the panel
  const [at, setAt] = useState(pathname);
  if (at !== pathname) {
    setAt(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setHost(button.current?.closest('[data-ui="v2"]') ?? document.body);
    setOpened(unread.map((n) => n.id));
    setOpen(true);
    refresh();
    // what is shown now counts as seen on this device
    writeSeen(tenantId, markAllSeen(items, seenList));
  };
  // a notice that arrives while the panel is open is shown at once and counts as seen
  useEffect(() => {
    if (open && items.some((n) => !seenList.includes(n.id))) writeSeen(tenantId, markAllSeen(items, seenList));
  }, [open, items, seenList, tenantId]);

  const turnOn = async () => {
    if (typeof Notification === "undefined") return;
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    if (result === "granted") {
      writeAnnounced(tenantId, items.filter((n) => n.kind === "needs_you").map((n) => n.id)); // what is already waiting is not announced as news
      setBrowserOptIn(true);
    }
  };
  const turnOff = () => setBrowserOptIn(false);

  const label = count > 0 ? word(labels, "notify.label.new", "Notifications, {n} new", { n: count }) : word(labels, "notify.label", "Notifications");
  const shown = count > 99 ? "99+" : String(count);
  const browserOn = optIn && permission === "granted";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-notify="bell"
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-edge bg-surface text-ink transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line"
      >
        <Bell className="size-5" aria-hidden="true" />
        {count > 0 ? (
          <span data-notify="count" aria-hidden="true" className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full border border-brand-edge bg-brand px-1 text-sm font-semibold leading-5 text-on-brand">
            {shown}
          </span>
        ) : null}
      </button>
      {open && host
        ? createPortal(
            <div
              ref={panel}
              id={id}
              role="region"
              aria-label={word(labels, "notify.title", "Notifications")}
              data-notify="panel"
              className="fixed inset-x-3 top-[4.25rem] z-[60] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-ink shadow-[var(--v2-shadow-pop)] md:inset-x-auto md:right-8 md:w-[26rem]"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-xl font-semibold">{word(labels, "notify.title", "Notifications")}</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label={word(labels, "notify.close", "Close")} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2">
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
                  <OwlSvg mood="resting" still className="size-14 shrink-0" />
                  <p className="text-base text-muted">{status === "loading" ? word(labels, "notify.loading", "Checking…") : word(labels, "notify.empty", "Nothing needs you right now.")}</p>
                </div>
              ) : (
                <ul className="mt-2 flex flex-col divide-y divide-line">
                  {items.map((n) => {
                    const Icon = ICON[n.code];
                    const isNew = opened.includes(n.id);
                    return (
                      <li key={n.id}>
                        <Link href={n.href} onClick={() => setOpen(false)} data-notice={n.code} className="flex min-h-14 items-start gap-3 rounded-lg px-1 py-3 hover:bg-surface-2">
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
          )
        : null}
    </>
  );
}
