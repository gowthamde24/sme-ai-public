"use client";

import { Bell } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { markAllSeen, parseSeen, toAnnounce, unreadOf, type Notice } from "@/lib/notifications/model";

import { announcedIds, browserOptInRaw, seenRaw, setBrowserOptIn, subscribeDevice, writeAnnounced, writeSeen } from "./device";
import { useNotifications } from "./use-notifications";
import { word, type Labels } from "../labels";
import type NotificationPanelType from "./NotificationPanel";


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
  // the panel's code is a chunk of its own, fetched when the panel is first opened (the bell is on every page, the panel is not; the route-JS budget counts what a page loads at first)
  const [Panel, setPanel] = useState<typeof NotificationPanelType | null>(null);
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
        const n = new Notification(word(labels, "notify.pop.title", "{assistant}"), { body, tag: `sme-needs-you:${tenantId}` });
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
    if (!Panel) void import("./NotificationPanel").then((m) => setPanel(() => m.default));
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
      {open && host && Panel ? (
        <Panel host={host} panelRef={panel} id={id} labels={labels} onClose={() => setOpen(false)} status={status} items={items} opened={opened} permission={permission} browserOn={browserOn} turnOn={turnOn} turnOff={turnOff} />
      ) : null}
    </>
  );
}
