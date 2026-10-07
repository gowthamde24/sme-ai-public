import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The rehearsal checklist (docs/rehearsal-followups-checklist.md) quotes, in double quotes, the exact sentences the screens show. This pins them: every double-quoted phrase of the checklist
 * must exist verbatim in the screens' source, so a reworded screen cannot leave the checklist telling the owner to look for a sentence that is gone. (Fixed texts the DATABASE makes are in
 * backticks and are pinned against the migrations by services/ai-api/tests/test_followups_web_pins.py.)
 */
const WEB = process.cwd(); // vitest runs from apps/web
const DOC = path.resolve(WEB, "../../docs/rehearsal-followups-checklist.md");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const SOURCE = [...sourceFiles(path.join(WEB, "app")), ...sourceFiles(path.join(WEB, "lib"))]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .replaceAll("&apos;", "'")
  .replaceAll("&quot;", '"');
const QUOTED = [...readFileSync(DOC, "utf8").matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);

/** A phrase is on a screen if it is in the source verbatim, or if the screen builds it with a number (touch ${n}) where the checklist shows one. */
function onAScreen(phrase: string): boolean {
  if (SOURCE.includes(phrase)) return true;
  if (!/\d/.test(phrase)) return false;
  const pattern = phrase
    .split(/(\d+)/)
    .map((part, i) => (i % 2 === 1 ? "\\$\\{[^}]+\\}" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(pattern).test(SOURCE);
}

describe("the follow-up rehearsal checklist quotes the screens", () => {
  it("quotes enough sentences to mean something", () => {
    expect(QUOTED.length).toBeGreaterThan(50);
  });

  it.each([...new Set(QUOTED)])("%s is on a screen", (phrase) => {
    expect(onAScreen(phrase)).toBe(true);
  });

  it("the checklist never tells the owner to look for a send button", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text).not.toMatch(/press "Send/i);
    expect(text).toMatch(/There is no button|there is none/);
  });
});
