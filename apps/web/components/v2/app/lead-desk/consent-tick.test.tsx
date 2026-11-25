import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appDict } from "@/i18n/app";
import type { Card } from "@/lib/sources/types";

import type { CardsBody, CardsPost } from "./cards-post";
import { ConsentTick } from "./ConsentTick";
import { SourceCards } from "./SourceCards";

afterEach(cleanup);
const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(sc|jobs\.trust|li)\./.test(k)));
const SENTENCE = "The form asks each person to agree to be contacted by phone and WhatsApp, in words they can read. Each answer is recorded with the date.";
const base = { detail: null, received7d: 0, receivedTotal: 0, lastReceivedAt: null, problem: null, available: true, state: "off" as const, canTest: false, canDisconnect: false, testLabel: null, costPerLeadPaise: null, costSource: null };
const CARDS: Card[] = [
  { ...base, kind: "meta", status: "not_connected", headline: "Not connected", action: "oauth" },
  { ...base, kind: "website", status: "not_connected", headline: "Not connected", action: "copy_snippet" },
];
let calls: CardsBody[];
const post = (async (b: CardsBody) => {
  calls.push(b);
  return b.op === "cards" ? { ok: true, data: CARDS } : b.op === "meta_connect" ? { ok: true, data: "https://www.facebook.com/dialog/oauth?x=1" } : { ok: true, data: null };
}) as unknown as CardsPost;
const show = (tick: boolean) => render(<SourceCards words={words} initial={CARDS} endpoint="/e" base="/app/tenants/T" metaReturn={false} post={post} consentTick={tick} />);
const card = (kind: string) => document.querySelector(`[data-card="${kind}"]`) as HTMLElement;
beforeEach(() => {
  calls = [];
});

describe("the consent tick", () => {
  it("is a round tick with the one sentence and the help line", () => {
    render(<ConsentTick words={words} id="x" checked={false} onChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: SENTENCE });
    expect(box).not.toBeChecked();
    expect(screen.getByText("Without this tick we do not connect.")).toBeInTheDocument();
  });
  it("Facebook: the button is off until the tick is ticked, then the call carries consentConfirmed", async () => {
    show(true);
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Connect" }));
    const go = within(card("meta")).getByRole("button", { name: "Continue with Facebook" }) as HTMLButtonElement;
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(calls.filter((c) => c.op === "meta_connect")).toHaveLength(0);
    fireEvent.click(within(card("meta")).getByRole("checkbox", { name: SENTENCE }));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(calls).toContainEqual({ op: "meta_connect", consentConfirmed: true }));
  });
  it("the website form: the same tick before it is turned on, and the call carries it", async () => {
    show(true);
    fireEvent.click(within(card("website")).getAllByRole("button")[0]);
    const on = within(card("website")).getByRole("button", { name: "Turn on the website form" }) as HTMLButtonElement;
    expect(on).toBeDisabled();
    fireEvent.click(within(card("website")).getByRole("checkbox", { name: SENTENCE }));
    fireEvent.click(on);
    await waitFor(() => expect(calls).toContainEqual({ op: "connect", card: "website", consentConfirmed: true }));
  });
  it("the API's 422 consent_required is said with the same sentence", async () => {
    const refusing = (async (b: CardsBody) => (b.op === "meta_connect" ? { ok: false, error: "consent_required" } : { ok: true, data: CARDS })) as unknown as CardsPost;
    render(<SourceCards words={words} initial={CARDS} endpoint="/e" base="/app/tenants/T" metaReturn={false} post={refusing} consentTick />);
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Connect" }));
    fireEvent.click(within(card("meta")).getByRole("checkbox", { name: SENTENCE }));
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Continue with Facebook" }));
    expect(await within(card("meta")).findByRole("alert")).toHaveTextContent(SENTENCE);
  });
  it("with JOBS off nothing changes: no tick, Connect is on, and the body has no consent field", async () => {
    show(false);
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Connect" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(within(card("meta")).getByRole("button", { name: "Continue with Facebook" }));
    await waitFor(() => expect(calls).toContainEqual({ op: "meta_connect" }));
  });
});

describe("the consent tick on an import (JOBS)", () => {
  it("the Owner's 'Check the list' stays off until the round tick is ticked; Sales (who cannot confirm) are not asked", async () => {
    const { ImportScreen } = await import("./ImportScreen");
    const iwords = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => /^(li|jobs\.trust)\./.test(k)));
    const actions = { read: async () => ({ ok: true as const, data: { kind: "paste", rows: 3, columns: [], fields: [], mapping: null, mapped_by: "none", needs_confirmation: false, warnings: [] } }), preview: async () => ({ ok: false as const, error: "down" }), import: async () => ({ ok: false as const, error: "down" }), createLink: async () => ({ ok: false as const, error: "down" }), linkAct: async () => ({ ok: false as const, error: "down" }) };
    const draw = (role: "owner" | "sales") => render(<ImportScreen words={iwords} base="/app/tenants/T" role={role} test={false} fileEndpoint="/x" actions={actions as never} sheets={null} consentTick />);
    const readPaste = async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Paste a list" }));
      fireEvent.change(screen.getByLabelText("Your list, one lead per line"), { target: { value: "Ravi, 9000000001" } });
      fireEvent.click(screen.getByRole("button", { name: "Read the list" }));
      await screen.findByText("3 leads found.");
    };
    draw("owner");
    await readPaste();
    expect(screen.getByRole("button", { name: "Check the list" })).toBeDisabled();
    expect(screen.queryByLabelText("These people wrote to me (their enquiry is in writing), or their consent is recorded.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: SENTENCE }));
    // the four facts are still asked for: the list is not checked until they are filled in
    expect(screen.getByRole("button", { name: "Check the list" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name of this list"), { target: { value: "Open day" } });
    fireEvent.change(screen.getByLabelText("What you will contact them about"), { target: { value: "New flats" } });
    fireEvent.change(screen.getByLabelText("How you got these numbers"), { target: { value: "Form at the stall" } });
    expect(screen.getByRole("button", { name: "Check the list" })).toBeEnabled();
    cleanup();
    draw("sales");
    await readPaste();
    expect(screen.queryByRole("checkbox", { name: SENTENCE })).toBeNull();
    expect(screen.getByRole("button", { name: "Check the list" })).toBeEnabled();
  });
});
