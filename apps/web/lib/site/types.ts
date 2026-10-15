import type { Lang } from "@/i18n/lang";

/** The shapes of the generated bundle (scripts/site-packs.mjs: packs/<id>/pack.json + landing.json). English is always there; a language that has no text falls back to English. */
export type Text = { readonly en: string } & Partial<Record<Exclude<Lang, "en">, string>>;
export type OwlId = "main" | "lead_finder" | "researcher" | "requirement_analyst" | "quote_writer" | "followup_desk" | "order_desk";
export type IconId = "message" | "file" | "bell" | "truck" | "calendar" | "wallet" | "users" | "image" | "calculator" | "shield";

export type CalculatorBlock = {
  title: Text;
  intro: Text;
  note: Text;
  products: readonly { id: string; name: Text; pieces_per_area_x1000: number; pieces_per_pallet: number }[];
  default_wastage_bps: number;
  truck_capacity_pieces: number;
};
export type FeePreviewBlock = { title: Text; label: Text; note: Text; messages: readonly { from: "school" | "parent"; text: Text }[] };
export type ChildrenPromiseBlock = { title: Text; points: readonly Text[]; note: Text };

export type SitePack = {
  id: string;
  status: "preview" | "published";
  validated: boolean;
  names: Text;
  summary: Text;
  accent: string;
  owlProp: string;
  /** The business type's own names for the seven owls (`agent.*` labels of its pack). */
  agents: Partial<Record<OwlId, Text>>;
  slug: string;
  meta: { title: Text; description: Text };
  hero: { eyebrow: Text; h1: Text; sub: Text };
  /** The plain card of the home page's "Currently built for" row. Optional: without it the card shows the name and the hero eyebrow. */
  home_card?: { title: Text; line: Text; link: Text };
  problem: { title: Text; points: readonly Text[] };
  day: { title: Text; steps: readonly { owl: OwlId; time: string; text: Text }[] };
  features: { title: Text; items: readonly { icon: IconId; title: Text; body: Text }[] };
  faq: readonly { q: Text; a: Text }[];
  plan_fit: { starter: Text; growth: Text; business: Text };
  calculator?: CalculatorBlock;
  fee_preview?: FeePreviewBlock;
  children_promise?: ChildrenPromiseBlock;
};
export type SitePacks = { packs: readonly SitePack[] };
