import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import { GUIDE_IDS, GUIDES, isGuide, mailFor } from "@/lib/lead-desk/guides";

import { BeforeYouCall } from "./BeforeYouCall";
import { GuideCards } from "./GuideCards";

afterEach(cleanup);
const words = appDict("en");

describe("Before you start calling", () => {
  it("five plain rules in order, open on Calls and closed behind 'Read the five rules' on Lead sources", () => {
    const { container, rerender } = render(<BeforeYouCall words={words} />);
    const rules = within(container.querySelector("ol") as HTMLElement).getAllByRole("listitem");
    expect(rules).toHaveLength(5);
    expect(rules[0]).toHaveTextContent("Only call people who agreed.");
    expect(rules[1]).toHaveTextContent("Calls go out between 9 am and 9 pm");
    expect(rules[2]).toHaveTextContent("never called again");
    expect(rules[3]).toHaveTextContent("Your business is the caller.");
    expect(container.querySelector("details")).toHaveAttribute("open");
    rerender(<BeforeYouCall words={words} open={false} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Read the five rules")).toBeInTheDocument();
  });
});

describe("Lead source guides", () => {
  it("seven cards, each linking to its guide page", () => {
    render(<GuideCards words={words} base="/b" />);
    expect(document.querySelectorAll("[data-guide]")).toHaveLength(7);
    expect(screen.getByRole("link", { name: /Google Sheets/ })).toHaveAttribute("href", "/b/lead-sources/guides/sheet");
    expect(screen.getByText("Works with anything that can send a web request.")).toBeInTheDocument();
  });
  it("every guide has three steps; the ones with a snippet name the address to paste; none holds a secret", () => {
    for (const id of GUIDE_IDS) {
      expect(GUIDES[id].steps).toHaveLength(3);
      expect(JSON.stringify(GUIDES[id])).not.toMatch(/s19_(live|test)_[0-9a-f]{8}|eyJ[A-Za-z0-9_-]{20,}/);
      if (id !== "mart" && id !== "fb") expect(JSON.stringify(GUIDES[id])).toMatch(/YOUR_ADDRESS|YOUR_KEY/);
    }
    expect(isGuide("web")).toBe(true);
    expect(isGuide("nope")).toBe(false);
  });
  it("the prepared mail to the developer carries the steps and no address", () => {
    const m = mailFor("My website", "web");
    expect(m.subject).toBe("Sending leads to Stack19: My website");
    expect(m.body).toContain("1. Make a contact form");
    expect(m.body).toContain("YOUR_ADDRESS");
    expect(m.body).not.toMatch(/https:\/\/api\.stack19\.in\/v1\/lead-intake\/[0-9a-f]{6}/);
  });
});
