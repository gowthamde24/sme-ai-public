import { BellRing, Building2, House, Receipt, Settings, Sparkles, Users, type LucideIcon } from "lucide-react";

import type { IconKey } from "./nav";

const ICONS: Record<IconKey, LucideIcon> = { today: House, customers: Users, orders: Receipt, followups: BellRing, catalogue: Building2, assistant: Sparkles, settings: Settings };

/** The icon of a nav group: decorative (the word beside it carries the meaning). */
export function NavIcon({ name, className = "size-5" }: { name: IconKey; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden="true" />;
}
