/**
 * The Help guides (job BT): which guides there are, the owl's mood for each, the screen each one opens, and which are English-only. The words are in the string store (`help.guide.<id>.t / .s / .1 ... .go`,
 * `help.tip.<screen>.1 ...`); a guide about what was sent, what is blocked, consent or erasure is English in every language until a person reviews it (`humanOnly` there, `englishOnly` here).
 */
import type { AiMood } from "@/components/v2/app/mark/mood";

export const GUIDE_IDS = ["today", "approve", "visits", "catalogue", "outbox", "agent", "voice", "privacy"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export type Guide = {
  id: GuideId;
  /** The number of numbered steps. */
  steps: number;
  mood: AiMood;
  /** Where the guide's button goes, relative to the workspace ("" = Today). */
  path: string;
  /** English in every language (money, consent, what was sent, erasure: not machine-translated). */
  englishOnly: boolean;
  /** The roles whose menu has that screen; the button is not drawn for the others (the guide is still readable). */
  roles: readonly string[];
};

const ALL = ["owner", "admin", "sales", "viewer"] as const;
const WRITERS = ["owner", "admin", "sales"] as const;

export const GUIDES: readonly Guide[] = [
  { id: "today", steps: 4, mood: "idle", path: "", englishOnly: false, roles: ALL },
  { id: "approve", steps: 4, mood: "listening", path: "", englishOnly: false, roles: ALL },
  { id: "visits", steps: 4, mood: "answering", path: "/visits", englishOnly: false, roles: ALL },
  { id: "catalogue", steps: 4, mood: "idle", path: "/catalogue", englishOnly: false, roles: ALL },
  { id: "outbox", steps: 4, mood: "thinking", path: "/outbox", englishOnly: true, roles: WRITERS },
  { id: "agent", steps: 4, mood: "thinking", path: "/settings?section=agent", englishOnly: false, roles: ALL },
  { id: "voice", steps: 4, mood: "listening", path: "", englishOnly: false, roles: ALL },
  { id: "privacy", steps: 4, mood: "resting", path: "/settings?section=privacy", englishOnly: true, roles: ["owner", "admin"] },
];

export const isGuideId = (v: string): v is GuideId => (GUIDE_IDS as readonly string[]).includes(v);
export const guideOf = (id: GuideId): Guide => GUIDES.find((g) => g.id === id) as Guide;
export const nextGuide = (id: GuideId): Guide => GUIDES[(GUIDES.findIndex((g) => g.id === id) + 1) % GUIDES.length];

/** The screens that carry a "?" tip, and the guide each one points at. */
export const TIP_SCREENS = { today: "today", outbox: "outbox", visits: "visits", catalogue: "catalogue", settings: "agent" } as const satisfies Record<string, GuideId>;
export type TipScreen = keyof typeof TIP_SCREENS;
export const TIP_LINES = 3;
