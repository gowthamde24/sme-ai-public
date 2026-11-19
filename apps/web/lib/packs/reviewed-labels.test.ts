import { afterEach, describe, expect, it, vi } from "vitest";

import { labelIn } from "./text";
import { packWords } from "./resolve";
import { withVisitWords } from "./visit-words";

const pack = {
  labels: {
    en: { "nav.item.chats": "Customer chats", "nav.item.retailers": "Find retailers", "word.visit": "Store visit" },
    te: { "nav.item.chats": "కస్టమర్ చాట్‌లు", "nav.item.retailers": "రిటైలర్లను వెతకండి", "word.visit": "షాప్ విజిట్" },
    hi: {},
    kn: {},
  },
} as never;

afterEach(() => vi.unstubAllEnvs());

describe("reviewed-only mode and the pack file's own words", () => {
  it("off: the pack's Telugu is used as before", () => {
    expect(packWords(pack, "te")["nav.item.chats"]).toBe("కస్టమర్ చాట్‌లు");
    expect(labelIn((pack as { labels: never }).labels, "nav.item.chats", "te")).toBe("కస్టమర్ చాట్‌లు");
  });
  it("on: none of the pack's unreviewed Telugu is used (no pack word at all), and the English never hides the store's own word", () => {
    vi.stubEnv("REVIEWED_TRANSLATIONS_ONLY", "1");
    expect(packWords(pack, "te")).toEqual({});
    expect(packWords(pack, "en")["nav.item.chats"]).toBe("Customer chats");
    const t = withVisitWords(((k: string) => k) as never, pack, "te") as unknown as (k: string) => string;
    expect(t("today.act.visit.row")).toBe("today.act.visit.row"); // unchanged: the store's own word is used
    expect(labelIn((pack as { labels: never }).labels, "nav.item.chats", "te")).toBe("Customer chats");
  });
});
