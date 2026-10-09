import { Armchair, Building2, FileText, Inbox, Package, Plug, Settings, Tags, Users, type LucideIcon } from "lucide-react";

import type { IconKey } from "./nav";

const ICONS: Record<IconKey, LucideIcon> = { today: Inbox, leads: Users, quotes: FileText, orders: Package, customers: Building2, catalogue: Tags, office: Armchair, integrations: Plug, settings: Settings };

/** The icon of a nav item: decorative (the word beside it carries the meaning). */
export function NavIcon({ name, className = "size-5" }: { name: IconKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
