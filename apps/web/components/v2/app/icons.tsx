import { Armchair, ChartColumn, Building2, CalendarDays, Images, MessagesSquare, Send, FileText, Inbox, Package, Plug, Settings, Store, Tags, Users, UsersRound, type LucideIcon } from "lucide-react";

import type { IconKey } from "./nav";

const ICONS: Record<IconKey, LucideIcon> = { today: Inbox, leads: Users, quotes: FileText, orders: Package, visits: CalendarDays, outbox: Send, report: ChartColumn, customers: Building2, catalogue: Tags, sarees: Images, office: Armchair, integrations: Plug, settings: Settings, retailers: Store, team: UsersRound, chats: MessagesSquare };

/** The icon of a nav item: decorative (the word beside it carries the meaning). */
export function NavIcon({ name, className = "size-5" }: { name: IconKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
