export const TAB_KEYS = ["overview", "voice", "rules", "responsibilities", "activity", "phone"] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const isTab = (v: unknown): v is TabKey => (TAB_KEYS as readonly unknown[]).includes(v);
