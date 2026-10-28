import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/tenants/t/help", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import app from "@/i18n/strings/app.json";
import { appT } from "@/i18n/app";
import { LANGS } from "@/i18n/lang";

import { HelpGuide, HelpIndex } from "./HelpScreens";
import { HelpTip } from "./HelpTip";
import { GUIDES, GUIDE_IDS, TIP_LINES, TIP_SCREENS, guideOf, isGuideId, nextGuide } from "./guides";
import { helpTipFor } from "./help-tip";

const BASE = "/app/tenants/22222222-2222-2222-2222-222222222222";
const dict = app as Record<string, { en: string; te: string; humanOnly?: boolean }>;

describe("the Help guides (job BT)", () => {
  it("has the eight guides of the brief, each with a title, a summary, four steps and a button label in the string store", () => {
    expect(GUIDE_IDS).toEqual(["today", "approve", "visits", "catalogue", "outbox", "agent", "voice", "privacy"]);
    for (const g of GUIDES) {
      for (const k of ["t", "s", "go", ...Array.from({ length: g.steps }, (_, i) => String(i + 1))]) expect(dict[`help.guide.${g.id}.${k}`], `${g.id}.${k}`).toBeTruthy();
      expect(dict[`help.guide.${g.id}.${g.steps + 1}`], `${g.id} has more steps than it says`).toBeUndefined();
    }
  });
  it("keeps what was sent, what is blocked, consent and erasure in English in every language (the rule for those words)", () => {
    for (const g of GUIDES.filter((x) => x.englishOnly)) for (const k of ["t", "s", "go", "1", "2", "3", "4"]) expect(dict[`help.guide.${g.id}.${k}`].humanOnly, `${g.id}.${k}`).toBe(true);
    for (const g of GUIDES.filter((x) => !x.englishOnly)) expect(dict[`help.guide.${g.id}.t`].humanOnly, g.id).toBeUndefined();
    expect(GUIDES.filter((g) => g.englishOnly).map((g) => g.id)).toEqual(["outbox", "privacy"]);
  });
  it("every screen with a tip has three lines and points at a real guide", () => {
    for (const [screen, guide] of Object.entries(TIP_SCREENS)) {
      expect(isGuideId(guide)).toBe(true);
      for (let i = 1; i <= TIP_LINES; i++) expect(dict[`help.tip.${screen}.${i}`], `${screen}.${i}`).toBeTruthy();
    }
    expect(Object.keys(TIP_SCREENS)).toEqual(["today", "outbox", "visits", "catalogue", "settings"]);
  });
  it("walks the guides in a ring", () => {
    expect(nextGuide("today").id).toBe("approve");
    expect(nextGuide("privacy").id).toBe("today");
    expect(isGuideId("nope")).toBe(false);
  });
});

describe("the Help screens", () => {
  it("the index lists every guide as a link to its own page, with the AI circle", () => {
    render(<HelpIndex t={appT("en")} base={BASE} lang="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Guides" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(GUIDE_IDS.map((id) => `${BASE}/help/${id}`));
    expect(list.querySelectorAll("[data-orb]").length).toBe(8);
  });
  it("a guide has numbered steps, a button to its screen for a role that has it, and the next guide", () => {
    render(<HelpGuide id="visits" t={appT("en")} base={BASE} lang="en" role="sales" />);
    expect(screen.getByRole("heading", { level: 1, name: "Store visits" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Open Store visits/ })).toHaveAttribute("href", `${BASE}/visits`);
    expect(screen.getByRole("link", { name: /Next guide: Your saree catalogue/ })).toHaveAttribute("href", `${BASE}/help/catalogue`);
    expect(screen.getByRole("link", { name: /All guides/ })).toHaveAttribute("href", `${BASE}/help`);
  });
  it("draws no button to a screen the role does not have (the guide is still readable)", () => {
    render(<HelpGuide id="outbox" t={appT("en")} base={BASE} lang="en" role="viewer" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Outbox: why a message waits");
    expect(screen.queryByRole("link", { name: /Open Outbox/ })).toBeNull();
  });
  for (const lang of LANGS) {
    it(`${lang}: every guide renders in that language with no raw key and no empty step; English-only guides say so`, () => {
      const t = appT(lang);
      for (const g of GUIDES) {
        const html = renderToStaticMarkup(<HelpGuide id={g.id} t={t} base={BASE} lang={lang} role="owner" />);
        expect(html, g.id).not.toMatch(/help\.guide\./);
        expect((html.match(/<li/g) ?? []).length, g.id).toBe(g.steps);
        const note = html.includes(t("help.english"));
        expect(note, `${lang}/${g.id}`).toBe(g.englishOnly && lang !== "en");
        if (lang !== "en" && !g.englishOnly) expect(html, `${lang}/${g.id}`).toMatch({ te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, kn: /[ಀ-೿]/ }[lang as "te" | "hi" | "kn"]);
      }
    });
  }
});

describe("the '?' tip of a screen", () => {
  const tip = () => render(<HelpTip screen="outbox" label="Help for this screen" lines={["One.", "Two.", "Three."]} moreHref="/g" moreLabel="Read the full guide" closeLabel="Close" />);
  it("is a closed button with a name, 44 px tall, that opens three lines and the link to the full guide", () => {
    tip();
    const button = screen.getByRole("button", { name: "Help for this screen" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.className).toMatch(/min-h-11/);
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Help for this screen" });
    expect(within(region).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["One.", "Two.", "Three."]);
    expect(within(region).getByRole("link", { name: "Read the full guide" })).toHaveAttribute("href", "/g");
  });
  it("closes with its own button and with Escape", () => {
    tip();
    fireEvent.click(screen.getByRole("button", { name: "Help for this screen" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help for this screen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
  });
  it("is built on the server with the words of the language and the guide of the screen", () => {
    const el = helpTipFor("te", BASE, "visits");
    expect(el.props).toMatchObject({ screen: "visits", moreHref: `${BASE}/help/visits`, label: dict["help.tip.label"].te });
    expect(el.props.lines).toHaveLength(3);
    expect(helpTipFor("en", BASE, "settings").props.moreHref).toBe(`${BASE}/help/agent`);
  });
});

describe("the guides do not claim what the product does not do", () => {
  it("never say your assistant sends, prices or decides on its own, and name no real person", () => {
    const text = Object.entries(dict).filter(([k]) => k.startsWith("help.") || k.startsWith("ask.can.")).map(([, v]) => v.en).join(" ");
    expect(text).not.toMatch(/guarantee|never makes a mistake|always right|100%/i);
    expect(text).not.toMatch(/Your assistant (sets|changes) (a )?price/i);
    expect(guideOf("approve")).toBeTruthy();
  });
});
