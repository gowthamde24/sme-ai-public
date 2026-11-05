import type { IconKey } from "./nav";

/**
 * The menu's line icons (sidebar v2: real line icons, never a square that looks like a tick box) from ONE static sprite, public/icons/nav.svg (lucide's shapes, made by scripts/nav-icons.mjs), drawn with <use>: they cost the pages'
 * JavaScript nothing (the route-JS budget), the browser fetches the sprite once and keeps it. `SPRITE_VERSION` is the sprite's hash (a new sprite is a new address, so no browser keeps an old one); the unit test checks it.
 */
export const SPRITE_VERSION = "934655b94a";
export type SpriteId =
  | "calendar-days" | "mic" | "inbox" | "search" | "phone" | "message-square" | "history" | "map-pin" | "package" | "images" | "file-text" | "shopping-cart" | "truck" | "indian-rupee" | "clipboard-list" | "graduation-cap" | "megaphone"
  | "chart-column" | "users" | "pen-line" | "smartphone" | "link-2" | "settings" | "send" | "building-2" | "armchair" | "plug" | "store" | "users-round" | "tags"
  | "chevron-down" | "menu" | "circle-help" | "panel-left-close" | "panel-left-open" | "log-out" | "x";

export const ICONS: Record<IconKey, SpriteId> = {
  today: "calendar-days",
  assistant: "mic",
  leads: "inbox",
  find: "search",
  calls: "phone",
  chats: "message-square",
  followups: "history",
  visits: "map-pin",
  catalogue: "package",
  sarees: "images",
  quotes: "file-text",
  orders: "shopping-cart",
  trips: "truck",
  dues: "indian-rupee",
  fees: "indian-rupee",
  admissions: "clipboard-list",
  students: "graduation-cap",
  announcements: "megaphone",
  report: "chart-column",
  aiteam: "users",
  train: "pen-line",
  phone: "smartphone",
  sources: "link-2",
  settings: "settings",
  outbox: "send",
  customers: "building-2",
  office: "armchair",
  integrations: "plug",
  retailers: "store",
  team: "users-round",
  campaigns: "calendar-days",
  sites: "store",
  programmes: "tags",
};

/** One icon of the sprite: decorative (the word beside it carries the meaning). */
export function SpriteIcon({ id, className = "size-5" }: { id: SpriteId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" data-icon={id}>
      <use href={`/icons/nav.svg?v=${SPRITE_VERSION}#${id}`} />
    </svg>
  );
}

/** The icon of a nav item. */
export function NavIcon({ name, className = "size-5" }: { name: IconKey; className?: string }) {
  return <SpriteIcon id={ICONS[name]} className={className} />;
}
