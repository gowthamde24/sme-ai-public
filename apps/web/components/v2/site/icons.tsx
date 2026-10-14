import { Bell, CalendarDays, Calculator, FileText, Image as ImageIcon, MessageCircle, ShieldCheck, Truck, Users, Wallet, type LucideIcon } from "lucide-react";

import type { IconId } from "@/lib/site/types";

/** The closed list of feature icons a landing.json may name (landing.schema.json); a server component, so no icon code reaches the browser. */
const ICONS: Record<IconId, LucideIcon> = { message: MessageCircle, file: FileText, bell: Bell, truck: Truck, calendar: CalendarDays, wallet: Wallet, users: Users, image: ImageIcon, calculator: Calculator, shield: ShieldCheck };

export function FeatureIcon({ id, className = "size-6" }: { id: IconId; className?: string }) {
  const Icon = ICONS[id] ?? MessageCircle;
  return <Icon className={className} aria-hidden="true" />;
}
