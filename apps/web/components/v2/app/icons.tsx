import { BellRing, Building2, House, Inbox, Receipt, ShieldCheck, Sparkles, Users, type LucideIcon } from "lucide-react";

import type { IconKey } from "./nav";

const ICONS: Record<IconKey, LucideIcon> = { today: House, followups: BellRing, leads: Inbox, customers: Users, orders: Receipt, catalogue: Building2, assistant: Sparkles, safety: ShieldCheck };

/** The icon of a nav group: decorative (the word beside it carries the meaning). */
export function NavIcon({ name, className = "size-5" }: { name: IconKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
