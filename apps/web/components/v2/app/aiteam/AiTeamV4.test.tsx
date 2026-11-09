import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AiTeamTabs, EarlierReports, ReportLayout, TodoTomorrow } from "./AiTeamV4";

const words = {
  "aiteam.v4.tabs": "AI team views",
  "aiteam.v4.tab.report": "Today's report",
  "aiteam.v4.tab.report.day": "Report",
  "aiteam.v4.tab.shift": "Today's shift",
  "aiteam.v4.tab.helpers": "Helpers",
  "aiteam.v4.todo": "To do tomorrow",
  "aiteam.v4.todo.none": "Nothing waits for you.",
  "aiteam.v4.todo.quotes.one": "Approve 1 quote",
  "aiteam.v4.todo.quotes.many": "Approve {n} quotes",
  "aiteam.v4.todo.quotes.b": "They wait for your OK.",
  "aiteam.v4.todo.quotes.btn": "Review quotes",
  "aiteam.v4.earlier": "Earlier reports",
  "aiteam.v4.earlier.none": "No earlier reports yet.",
  "aiteam.v4.earlier.open": "Open the report of {day}",
  "aiteam.v4.min": "{n} min",
  "aiteam.standup.seconds": "{seconds} seconds",
};
afterEach(cleanup);
const B = "/app/tenants/t";

describe("the tabs", () => {
  it("are real links; the current one is marked; a past day is kept in every link", () => {
    render(<AiTeamTabs words={words} base={B} tabs={["report", "shift", "helpers"]} current="shift" date="2026-11-05" today="2026-11-09" />);
    expect(screen.getByRole("link", { name: "Today's shift" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Helpers" })).toHaveAttribute("href", `${B}/ai-team?tab=helpers&date=2026-11-05`);
    expect(screen.getByRole("link", { name: "Report" })).toBeInTheDocument(); // not "Today's report" for another day
  });
  it("today's links carry no date, and a person without the report has two tabs", () => {
    render(<AiTeamTabs words={words} base={B} tabs={["shift", "helpers"]} current="shift" date="2026-11-09" today="2026-11-09" />);
    expect(screen.getByRole("link", { name: "Helpers" })).toHaveAttribute("href", `${B}/ai-team?tab=helpers`);
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });
});

describe("To do tomorrow", () => {
  it("a card for each thing that waits, with the number in words and one button to where it is done", () => {
    render(<TodoTomorrow words={words} todos={[{ key: "quotes", n: 2, href: `${B}/quotes` }]} />);
    expect(screen.getByText("Approve 2 quotes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review quotes" })).toHaveAttribute("href", `${B}/quotes`);
  });
  it("one is singular; Indian digits are used for big numbers", () => {
    render(<TodoTomorrow words={words} todos={[{ key: "quotes", n: 1, href: "/x" }]} />);
    expect(screen.getByText("Approve 1 quote")).toBeInTheDocument();
    cleanup();
    render(<TodoTomorrow words={words} todos={[{ key: "quotes", n: 123456, href: "/x" }]} />);
    expect(screen.getByText("Approve 1,23,456 quotes")).toBeInTheDocument();
  });
  it("nothing waiting is said plainly, with no card", () => {
    render(<TodoTomorrow words={words} todos={[]} />);
    expect(screen.getByText("Nothing waits for you.")).toBeInTheDocument();
    expect(document.querySelector("[data-todo]")).toBeNull();
  });
});

describe("Earlier reports", () => {
  it("the days that had one, each a link with its length (minutes from a minute, else seconds)", () => {
    render(<EarlierReports words={words} base={B} locale="en-IN" current="2026-11-09" items={[{ date: "2026-11-08", seconds: 120 }, { date: "2026-11-07", seconds: 38 }, { date: "2026-11-06", seconds: null }]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", `${B}/ai-team?tab=report&date=2026-11-08`);
    expect(links[0]).toHaveTextContent("2 min");
    expect(links[1]).toHaveTextContent("38 seconds");
    expect(links[2]).not.toHaveTextContent(/min|seconds/);
  });
  it("says so when there are none", () => {
    render(<EarlierReports words={words} base={B} locale="en-IN" current="2026-11-09" items={[]} />);
    expect(screen.getByText("No earlier reports yet.")).toBeInTheDocument();
  });
});

describe("the report layout", () => {
  it("holds the scene and the side in one grid", () => {
    render(<ReportLayout scene={<p>scene</p>} side={<p>side</p>} />);
    expect(document.querySelector("[data-part=report-layout]")).toHaveTextContent("scene");
    expect(document.querySelector("[data-part=report-layout]")).toHaveTextContent("side");
  });
});
