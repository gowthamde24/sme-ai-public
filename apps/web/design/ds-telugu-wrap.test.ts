import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "ds.css"), "utf8");
const block = css.slice(css.indexOf("TELUGU WRAPS, IT IS NEVER CUT"));

describe("Telugu wraps instead of being cut (Customer Zero Telugu check)", () => {
  it.each(["data-needs-sub", "data-call-dir-label", "data-chat-sub"])("%s is only changed on a Telugu page, in the layer that beats Tailwind's truncate", (hook) => {
    const rules = block.split("\n").filter((l) => l.includes(`[${hook}]`));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toContain(':lang(te) [');
      expect(rule).toContain("!important");
    }
    expect(block).toContain("@layer theme");
  });
  it("the markup carries the three hooks", () => {
    const read = (p: string) => readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
    expect(read("components/v2/app/today/NeedsYou.tsx")).toContain("data-needs-sub");
    expect(read("components/v2/app/calls/v6/CallsTable.tsx")).toContain("data-call-dir-label");
    expect(read("components/v2/app/chats/v6/Conversation.tsx")).toContain("data-chat-sub");
  });
});
