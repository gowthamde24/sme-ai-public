import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { appDict, appT } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";
import { withModuleWords } from "@/lib/packs/module-words";
import { SITE_PACKS, textIn } from "@/lib/site/packs";

import { AskCapabilities } from "./AskCapabilities";
import { ASK_WORD_KEYS } from "./ask-words";

const en = appT("en") as (k: string) => string;
const w = (k: string) => en(k);

describe("What can your assistant do? (job BT)", () => {
  const setup = (onTry = vi.fn()) => ({ onTry, ...render(<AskCapabilities w={w} examples={["What needs me today?", "Which quotes are waiting for me?"]} onTry={onTry} guideHref="/guide" />) });
  it("is a closed 44 px button under the Ask box", () => {
    setup();
    const button = screen.getByRole("button", { name: "What can your assistant do?" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.className).toMatch(/min-h-11/);
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("opens a card with what it can and cannot do, examples to try and the guide", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "What can your assistant do?" }));
    const card = screen.getByRole("region", { name: "What your assistant can do for you" });
    expect(within(card).getByRole("heading", { name: "It can" })).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "It cannot" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Change your records or your prices.");
    expect(card).toHaveTextContent("Send or approve a message from this box.");
    expect(within(card).getByRole("link", { name: "Read the guide" })).toHaveAttribute("href", "/guide");
  });
  it("shows the six steps in the order of the workflow, each with the icon of its job: title, line and what you do", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "What can your assistant do?" }));
    const card = screen.getByRole("region", { name: "What your assistant can do for you" });
    const steps = within(card).getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"));
    expect(steps.map((li) => li.getAttribute("data-step"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(steps.map((li) => li.querySelector("p")!.textContent)).toEqual(["1Catch leads", "2Research", "3AI calls", "4WhatsApp", "5Outcome", "6Follow-up"]);
    expect(steps[3]).toHaveTextContent("You: approve quotes and prices");
    expect(steps.every((li) => li.querySelector("svg"))).toBe(true);
    expect(card.textContent).not.toMatch(/Lead Finder|Quote Writer/);
  });
  it("a school reads its own six steps, the same words as its public page's landing.json (data, not code)", () => {
    const edu = SITE_PACKS.find((p) => p.id === "education")!;
    for (const lang of LANGS) {
      const dict = appDict(lang) as Record<string, string>;
      const school = withModuleWords({ ...dict }, { modules: ["programmes"] });
      for (const n of ["1", "2", "3", "4", "5", "6"] as const) {
        expect(school[`ask.can.step.${n}.t`].replaceAll("\u2060", ""), `${lang} ${n}`).toBe(textIn(edu.steps![n]!.title, lang));
        expect(school[`ask.can.step.${n}.d`].replaceAll("\u2060", ""), `${lang} ${n}`).toBe(textIn(edu.steps![n]!.text, lang));
      }
      expect(school["ask.can.step.6.y"], lang).toBe(dict["ask.can.step.6.y"]);
    }
    const en = withModuleWords({ ...(appDict("en") as Record<string, string>) }, { modules: ["programmes"] });
    expect([en["ask.can.step.1.t"], en["ask.can.step.2.t"], en["ask.can.step.3.t"]]).toEqual(["Admission enquiries", "Know who's asking", "AI calls"]);
    expect(en["ask.can.step.2.d"]).toContain("never searches the web for students");
    expect(en["ask.can.step.6.d"]).toContain("never written by the AI");
  });
  it("asks an example when it is tapped, and closes", () => {
    const { onTry } = setup();
    fireEvent.click(screen.getByRole("button", { name: "What can your assistant do?" }));
    fireEvent.click(screen.getByRole("button", { name: "Which quotes are waiting for me?" }));
    expect(onTry).toHaveBeenCalledWith("Which quotes are waiting for me?");
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("closes with Escape and with its button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "What can your assistant do?" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What can your assistant do?" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("all its words travel with the Ask box (ask-words.ts) and exist in the store", () => {
    const keys = ASK_WORD_KEYS.filter((k) => k.startsWith("ask.can."));
    expect(keys).toHaveLength(16 + 18);
    for (const k of keys) expect(en(k), k).not.toBe(k);
  });
});
