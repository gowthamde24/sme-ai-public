import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/design/fonts", () => ({ v2FontClassName: (lang?: string) => `font-${lang ?? "all"}` }));
const nav = { pathname: "/app/tenants/22222222-2222-2222-2222-222222222222/orders" };
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));

import { frameLabels } from "@/i18n/app";

import { AccountMenu } from "./AccountMenu";
import { NO_FRAME_DATA, type FrameData } from "./contract";
import { AppFrame } from "./AppFrame";
import { SideNav } from "./SideNav";
import { TabBar } from "./TabBar";
import type { Membership } from "./use-workspace";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const A = "22222222-2222-2222-2222-222222222222";
const none: FrameData = NO_FRAME_DATA;
const members: Membership[] = [{ id: A, name: "Acme", role: "owner" }, { id: "33333333-3333-3333-3333-333333333333", name: "Second", role: "viewer" }];

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(cleanup);

describe("the frame in English is the same with or without the dictionary (language track L0, English parity)", () => {
  it.each([
    ["SideNav", (l?: Record<string, string>) => <SideNav memberships={members} labels={l} frame={none} email="o@example.test" signOut={async () => undefined} />],
    ["TabBar", (l?: Record<string, string>) => <TabBar memberships={members} labels={l} frame={none} email="o@example.test" signOut={async () => undefined} />],
    ["WorkspaceSwitcher", (l?: Record<string, string>) => <WorkspaceSwitcher memberships={members} labels={l} plan={null} />],
    ["AccountMenu", (l?: Record<string, string>) => <AccountMenu email="o@example.test" signOut={async () => undefined} labels={l} />],
  ])("%s", (_name, make) => {
    nav.pathname = `/app/tenants/${A}/orders/abc`;
    expect(renderToStaticMarkup(make(frameLabels("en")))).toBe(renderToStaticMarkup(make(undefined)));
  });
});

describe("the frame in Telugu", () => {
  const frame = (lang: "en" | "te") =>
    render(
      <AppFrame lang={lang} theme={undefined} email="o@example.test" memberships={members} signOut={async () => undefined}>
        <main>The page</main>
      </AppFrame>,
    );
  it("draws the menu words in Telugu, the page area stays English, and a note says the words are machine drafts", () => {
    nav.pathname = `/app/tenants/${A}/orders`;
    const { container } = frame("te");
    const menu = screen.getByRole("navigation", { name: "వర్క్‌స్పేస్ మెనూ" });
    expect(within(menu).getByRole("link", { name: "సేల్స్" })).toHaveAttribute("href", `/app/tenants/${A}/quotes`); // Sales: Quotes, Store visits and Orders are its tabs
    expect(container.querySelector("[data-ui='v2']")).toHaveAttribute("lang", "te");
    expect(container.querySelector("#main-content")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("region", { name: "అనువాద సూచన" })).toHaveTextContent("యంత్రం రాసింది");
    expect(screen.getByText("The page")).toBeInTheDocument();
  });
  it("draws the words of the new frame in Telugu too: the seven items, the foot and Help", () => {
    nav.pathname = `/app/tenants/${A}/orders`;
    frame("te");
    const menu = screen.getByRole("navigation", { name: "వర్క్‌స్పేస్ మెనూ" });
    for (const word of ["ఈరోజు", "కస్టమర్లు", "చాట్‌లు", "కాల్స్", "సేల్స్", "క్యాటలాగ్", "రిపోర్టులు"]) expect(within(menu).getByRole("link", { name: word })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "సెట్టింగ్స్" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "సహాయం" })).toHaveAttribute("href", `/app/tenants/${A}/help`);
  });
  it("English has no draft note and the page area is English too", () => {
    nav.pathname = `/app/tenants/${A}/orders`;
    const { container } = frame("en");
    expect(screen.queryByRole("region", { name: "Translation notice" })).toBeNull();
    expect(container.querySelector("[data-ui='v2']")).toHaveAttribute("lang", "en");
  });
});
