import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import { mockWallet } from "@/lib/api/wallet";
import type { Demo } from "@/lib/api/wallet-fixtures";
import { TOPUP_CHOICES } from "@/lib/billing-v6/mock-state";
import { formatRupeesShort } from "@/lib/money";

import { BillingV2, type BillingV2Props } from "./BillingV2";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

const setLimit = vi.fn(async () => ({ ok: true }) as const);
const props = (demo: Demo = "normal", over: Partial<BillingV2Props> = {}): BillingV2Props => ({
  words: appDict("en") as Record<string, string>,
  lang: "en",
  base: "/app/tenants/t1",
  help: <button type="button">?</button>,
  wallet: mockWallet(demo, {}),
  owner: true,
  topupAmounts: TOPUP_CHOICES.map((paise) => ({ paise, text: formatRupeesShort(paise) })),
  actions: { freeStart: async () => ({ ok: true }), topup: async () => ({ ok: true }), setLimit },
  ...over,
});
const line = (id: string) => document.querySelector(`[data-line="${id}"]`) as HTMLElement;

describe("Billing v2: the wallet", () => {
  it("is marked Preview with its sentence, shows the balance big and one usage line per feature", () => {
    render(<BillingV2 {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Billing" })).toBeInTheDocument();
    expect(document.querySelector('[data-part="preview"]')).toHaveTextContent("Preview");
    expect(document.querySelector('[data-part="preview"]')).toHaveTextContent("nothing is charged");
    expect(document.querySelector('[data-part="balance"]')).toHaveTextContent("₹1,550");
    expect([...document.querySelectorAll("[data-line]")].map((l) => l.getAttribute("data-line"))).toEqual(["calls", "numbers", "find_customers", "whatsapp"]);
    expect(line("calls")).toHaveTextContent("212.5 of 500 minutes used");
    expect(line("find_customers")).toHaveTextContent("3 of 10 free searches used");
    expect(line("find_customers")).toHaveTextContent("After that, each search is ₹39.");
    expect(line("whatsapp")).toHaveTextContent("WhatsApp costs what Meta charges. We add nothing.");
  });
  it("a normal month shows no chip and no upgrade hint", () => {
    render(<BillingV2 {...props()} />);
    expect(document.querySelectorAll(".bl-chip")).toHaveLength(2) /* Preview and Most popular */;
    expect(document.querySelector('[data-part="warn"]')).toBeNull();
    expect(document.querySelector('[data-part="upgrade-hint"]')).toBeNull();
    expect(document.querySelector('[data-part="wallet-warn"]')).toBeNull();
  });
  it("never says 'unlimited' and never the old plan names", () => {
    for (const demo of ["normal", "low80", "full100", "over", "upgrade", "numbers"] as const) {
      render(<BillingV2 {...props(demo)} />);
      expect(document.body.textContent ?? "", demo).not.toMatch(/unlimited|lead desk|workforce|lead finder/i);
      cleanup();
    }
  });
  it("without a read of billing: one plain error, no numbers", () => {
    render(<BillingV2 {...props("normal", { wallet: null })} />);
    expect(document.querySelector('[data-part="balance"]')).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("Billing v2: warnings at 80% and 100%", () => {
  it("80%: an amber chip and one sentence, and the low wallet says so", () => {
    render(<BillingV2 {...props("low80")} />);
    const warn = line("calls").querySelector('[data-part="warn"]') as HTMLElement;
    expect(warn).toHaveAttribute("data-warn", "at80");
    expect(warn.querySelector(".bl-chip")).toHaveAttribute("data-tone", "wait");
    expect(warn).toHaveTextContent("80 percent used");
    expect(warn).toHaveTextContent("You have used 80 percent of your included minutes.");
    const wallet = document.querySelector('[data-part="wallet-warn"]') as HTMLElement;
    expect(wallet.querySelector(".bl-chip")).toHaveAttribute("data-tone", "wait");
    expect(wallet).toHaveTextContent("Wallet is low");
    expect(wallet).toHaveTextContent("Add credits so your assistant's calls do not wait.");
    expect(line("find_customers").querySelector('[data-part="warn"]')).toHaveAttribute("data-warn", "at80"); // 8 of 10 free searches
  });
  it("100%: a red chip, 'All used', and the price of an extra minute from the wallet", () => {
    render(<BillingV2 {...props("full100")} />);
    const warn = line("calls").querySelector('[data-part="warn"]') as HTMLElement;
    expect(warn.querySelector(".bl-chip")).toHaveAttribute("data-tone", "fail");
    expect(warn).toHaveTextContent("All used");
    expect(warn).toHaveTextContent("All included minutes are used. Extra minutes cost ₹5 each from your wallet.");
    expect(line("calls")).toHaveTextContent("36 extra minutes: ₹180 from your wallet");
    expect(line("find_customers").querySelector('[data-part="warn"]')).toHaveTextContent("All free searches are used. Each search now costs ₹39 from your wallet.");
  });
  it("over the spending limit: red 'Stopped for this month' with the limit in the sentence, the limit choice shown", () => {
    render(<BillingV2 {...props("over")} />);
    const warn = line("calls").querySelector('[data-part="warn"]') as HTMLElement;
    expect(warn.querySelector(".bl-chip")).toHaveAttribute("data-tone", "fail");
    expect(warn).toHaveTextContent("Stopped for this month");
    expect(warn).toHaveTextContent("you reached your limit of ₹2,000");
    expect(within(line("calls")).getByRole("combobox", { name: /Stop calls for this month after/ })).toHaveValue("200000");
  });
  it("an empty wallet is a red chip and says calls wait, not lost", () => {
    const w = { ...mockWallet("normal", {}), balancePaise: 0, minutesEstimate: 0 };
    render(<BillingV2 {...props("normal", { wallet: w })} />);
    const wallet = document.querySelector('[data-part="wallet-warn"]') as HTMLElement;
    expect(wallet.querySelector(".bl-chip")).toHaveAttribute("data-tone", "fail");
    expect(wallet).toHaveTextContent("Calls wait in a queue, they are not lost.");
  });
});

describe("Billing v2: spending limits", () => {
  it("are plain sentences with the amount inside, three of them, and saving one calls the action and refreshes", async () => {
    render(<BillingV2 {...props()} />);
    expect(document.querySelectorAll('[data-part="limit"]')).toHaveLength(3);
    const calls = within(line("calls")).getByRole("combobox", { name: "Stop calls for this month after …" });
    expect([...calls.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["No limit", "₹500", "₹1,000", "₹2,000", "₹5,000"]);
    fireEvent.change(calls, { target: { value: "200000" } });
    await waitFor(() => expect(setLimit).toHaveBeenCalledWith("calls", 200_000));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });
  it("'No limit' saves null; a failed save puts the old choice back and says so", async () => {
    setLimit.mockResolvedValueOnce({ ok: false, error: "Could not save. Try again." } as never);
    render(<BillingV2 {...props("over")} />);
    const calls = within(line("calls")).getByRole("combobox");
    fireEvent.change(calls, { target: { value: "none" } });
    await waitFor(() => expect(setLimit).toHaveBeenCalledWith("calls", null));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(calls).toHaveValue("200000");
  });
  it("are not offered where the API cannot save them yet (only the real balance is known), and the screen says what is coming", () => {
    const w = { ...mockWallet("normal", {}), source: "balance" as const, limitsAvailable: false, lines: mockWallet("normal", {}).lines.filter((l) => l.feature === "calls") };
    render(<BillingV2 {...props("normal", { wallet: w })} />);
    expect(document.querySelectorAll('[data-part="limit"]')).toHaveLength(0);
    expect(document.querySelector('[data-part="preview"]')).toBeNull();
    expect(screen.getByText("Limits cannot be set yet.")).toBeInTheDocument();
    expect(screen.getByText(/will show here when it is ready/)).toBeInTheDocument();
    expect(line("numbers")).toBeNull();
  });
});

describe("Billing v2: the upgrade hint", () => {
  it("Pay as you go with 420 minutes: 'You'd save ₹600 on Pro this month', with the way it is worked out", () => {
    render(<BillingV2 {...props("upgrade")} />);
    const hint = document.querySelector('[data-part="upgrade-hint"]') as HTMLElement;
    expect(hint).toHaveAttribute("data-plan", "pro");
    expect(hint).toHaveTextContent("You'd save ₹600 on Pro this month.");
    expect(hint).toHaveTextContent("Worked out from what you used so far this month.");
    expect(within(hint).getByRole("link", { name: "See Pro" })).toHaveAttribute("href", "/app/tenants/t1/plans");
  });
  it("only the Owner gets the link", () => {
    render(<BillingV2 {...props("upgrade", { owner: false })} />);
    expect(document.querySelector('[data-part="upgrade-hint"]')).not.toBeNull();
    expect(document.querySelector('[data-part="hint-link"]')).toBeNull();
  });
});

describe("Billing v2: numbers on demand", () => {
  it("1 number included, each extra ₹499 a month, and 'Add a number' goes to the Phone number page (nothing is bought here)", () => {
    render(<BillingV2 {...props("numbers")} />);
    expect(line("numbers")).toHaveTextContent("You have 3 numbers");
    expect(line("numbers")).toHaveTextContent("1 number is included. Each extra number is ₹499 a month.");
    expect(line("numbers")).toHaveTextContent("Extra numbers this month: ₹998");
    expect(within(line("numbers")).getByRole("link", { name: "Add a number" })).toHaveAttribute("href", "/app/tenants/t1/phone-number");
    expect(within(line("numbers")).queryByRole("button")).toBeNull();
  });
});

describe("Billing v2: the plans and the rules, under one 'More choices'", () => {
  it("shows Pay as you go, Pro (most popular) and Business with the owner's numbers + GST", () => {
    render(<BillingV2 {...props()} />);
    const plans = [...document.querySelectorAll("[data-plan]")].filter((e) => e.closest('[data-part="plans"]'));
    expect(plans.map((p) => p.getAttribute("data-plan"))).toEqual(["payg", "pro", "business"]);
    const [payg, pro, business] = plans;
    expect(payg).toHaveTextContent("₹499 a month + GST");
    expect(payg).toHaveTextContent("Calls ₹5 a minute");
    expect(payg).toHaveTextContent("2 free searches, then ₹49 each");
    expect(pro).toHaveTextContent("Most popular");
    expect(pro).toHaveTextContent("₹1,999 a month + GST");
    expect(pro).toHaveTextContent("500 minutes included, extra minutes ₹5 each");
    expect(pro).toHaveTextContent("Your plan");
    expect(business).toHaveTextContent("₹5,999 a month + GST");
    expect(business).toHaveTextContent("1,500 minutes included");
    expect(business).toHaveTextContent("100 free searches, then ₹29 each");
    expect(business).toHaveTextContent("Priority onboarding");
    expect(screen.getByText("Every plan gets every feature.")).toBeInTheDocument();
    expect(document.querySelector('[data-part="how"]')).toHaveTextContent("Calls are billed every 30 seconds. Calls nobody answers are free.");
  });
});

describe("Billing v2: the words", () => {
  it("every bill.* string exists in all four languages, and a money rule is the English until a person who speaks the language has read it", () => {
    const en = appDict("en") as Record<string, string>;
    const keys = Object.keys(en).filter((k) => k.startsWith("bill."));
    expect(keys.length).toBeGreaterThan(60);
    for (const l of ["te", "hi", "kn"] as const) {
      const d = appDict(l) as Record<string, string>;
      for (const k of keys) expect(d[k], `${k} ${l}`).toBeTruthy();
      if (l !== "te") expect(d["bill.limit.calls"]).toBe(en["bill.limit.calls"]); // (Telugu is approved, money rules included: 26 Nov 2026)
      expect(d["bill.title"]).not.toBe(en["bill.title"]);
    }
    for (const k of keys) expect(en[k], k).not.toMatch(/unlimited/i);
  });
});

describe("Billing v2 is a Server Component: a client part gets server actions and plain data, never a function made on the page", () => {
  it("no prop of LimitLine, TopupSheet or FreeStartButton is an inline arrow (staging 00272: 'Functions cannot be passed directly to Client Components', React error 441)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/v2/app/billing/v2/BillingV2.tsx"), "utf8");
    // each element runs from "<Tag" to its closing "/>" (an arrow's ">" does not end it: the elements here have no children)
    for (const tag of ["LimitLine", "TopupSheet", "FreeStartButton"]) {
      const starts = [...src.matchAll(new RegExp(`<${tag}\\b`, "g"))];
      expect(starts.length, tag).toBeGreaterThan(0);
      for (const m of starts) {
        const end = src.indexOf("/>", m.index as number);
        expect(src.slice(m.index as number, end), tag).not.toMatch(/=>/);
      }
    }
  });
});
