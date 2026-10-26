import { BookOpen, BrickWall, Building2, Car, ChevronRight, Dumbbell, GraduationCap, Plane, ShieldCheck, Sofa, Spool, Stethoscope, Store, Truck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createElement } from "react";

import type { SignupCard } from "@/lib/packs/signup";

/** The art for each owl prop a business type names (`owl_prop` of its pack). A prop this build has no art for draws a neutral shop until the art job gives the owl real props. */
export const PROPS: Readonly<Record<string, LucideIcon>> = {
  fabric_roll: Spool, hard_hat_paver_block: BrickWall, graduation_cap: GraduationCap,
  // job DR / A1: the nine "Leads & calls" business types (a stand-in lucide icon each until the art job draws the owl's own props)
  building: Building2, open_book: BookOpen, stethoscope: Stethoscope, shield_check: ShieldCheck, car: Car, sofa_sun: Sofa, paper_plane: Plane, dumbbell: Dumbbell, delivery_truck: Truck,
};

/** The prop icon for an owl prop token (a neutral shop for one this build has no art for). Shared with the public site's business cards. */
const propFor = (owlProp: string): LucideIcon => PROPS[owlProp] ?? Store;

/** The prop icon drawn (a server component with no state). */
export function PackProp({ owlProp, className }: { owlProp: string; className?: string }) {
  return createElement(propFor(owlProp), { className, "aria-hidden": true });
}

/**
 * One kind of business on the first sign-up step (job CL, blueprint 3.1): the prop of that trade (a reel of fabric, a paver block, a graduation cap: drawn with an icon) in the business type's accent colour, the name and one line. Job CX took the owl off the card. A plain link to step 2 (`/signup?type=<id>`): no script, back button and refresh work, and the choice is in the address. The accent colour is a small touch (the prop's tile), not a theme.
 */
export function PackCard({ card, href, hint, notValidated }: { card: SignupCard; href: string; hint: string; /** The line for a type no real owner of that trade has reviewed yet ("Not validated by a real owner yet"). */ notValidated?: string }) {
  return (
    <Link href={href} data-pack-card={card.id} className="group flex min-h-24 items-center gap-4 rounded-2xl border border-edge bg-surface p-4 transition-colors duration-150 ease-out hover:bg-surface-2 active:bg-line">
      <span data-accent={card.accent} aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-pack-bg text-pack-text">
        <PackProp owlProp={card.owlProp} className="size-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-xl font-semibold leading-tight">{card.name}</span>
        <span className="mt-0.5 block text-base text-muted">{card.tagline}</span>
        {!card.validated && notValidated ? <span className="mt-1 block text-sm font-medium text-pack-text" data-accent={card.accent}>{notValidated}</span> : null}
      </span>
      <ChevronRight className="size-6 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
      <span className="sr-only">{hint}</span>
    </Link>
  );
}
