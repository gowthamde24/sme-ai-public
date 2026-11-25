import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TypeGroup, TypeWords } from "@/components/v2/auth/TypeCombobox";
import { wordsFor } from "@/i18n/app-words";
import { appDict } from "@/i18n/app";
import type { Member } from "@/lib/api/team";
import { BUSINESS_LANGUAGES } from "@/lib/api/profile";
import { CALL_LANGS } from "@/lib/assistant/types";

import { BusinessCardV6 } from "../BusinessCardV6";
import { BusinessForm } from "../BusinessForm";
import { SettingsV6, type SettingsV6Props } from "../SettingsV6";
import type { SettingsV6Data } from "@/app/app/tenants/[tenantId]/settings/settings-v6-data";
import { TeamMembers } from "../../team/TeamMembers";
import { InviteForm } from "../../team/InviteForm";
import type { TeamActions } from "../../team/team-types";
import { BusinessSimple } from "./BusinessSimple";
import { LanguageSimple } from "./LanguageSimple";
import { NotificationsSimple } from "./NotificationsSimple";
import { InviteSimple, TeamMembersSimple } from "./TeamSimple";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("./Lazy", async () => ({ BusinessSimple: (await import("./BusinessSimple")).BusinessSimple, LanguageSimple: (await import("./LanguageSimple")).LanguageSimple, NotificationsSimple: (await import("./NotificationsSimple")).NotificationsSimple, TeamMembersSimple: (await import("./TeamSimple")).TeamMembersSimple, InviteSimple: (await import("./TeamSimple")).InviteSimple }));

const words = wordsFor("en", ["jobs.set.", "settings.biz.", "sv6.", "nset.", "team.", "apierr.", "settings.language.", "settings.theme."], ["catalogue.v6.publish", "today.act.edit", "today.act.cancel", "dta.btn.working", "dta.btn.copied", "dta.cal.copy_failed", "sv6.na"]);
beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
  document.cookie = "sme_lang=; Max-Age=0";
  document.cookie = "sme_theme=; Max-Age=0";
});
afterEach(cleanup);

/** A sentence as the person reads it: each select shows the option it has chosen. */
const said = (el: Element | null): string => {
  const clone = el!.cloneNode(true) as HTMLElement;
  const live = Array.from(el!.querySelectorAll("select"));
  clone.querySelectorAll("select").forEach((sel, i) => sel.replaceWith(document.createTextNode(live[i].selectedOptions[0]?.textContent ?? "")));
  clone.querySelectorAll("input[type=text]").forEach((inp) => inp.replaceWith(document.createTextNode((inp as HTMLInputElement).value)));
  clone.querySelectorAll("svg").forEach((n) => n.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
};
const line = (id: string) => document.querySelector(`[data-setting-line='${id}']`);
const entries = (fd: FormData) => Array.from(fd.entries()).map(([k, v]) => [k, String(v)] as const).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
const type = (label: string | RegExp, value: string) => act(async () => void fireEvent.change(screen.getByLabelText(label), { target: { value } }));
const submit = (el: Element) => act(async () => void fireEvent.submit(el.closest("form")!));

const TYPE_WORDS: TypeWords = { label: "Kind of business", placeholder: "Search", none: "Nothing", otherAsk: "What is your business?", otherHint: "2 to 60 letters" };
const GROUPS: TypeGroup[] = [{ key: "leads", label: "Businesses with enquiries", options: [{ id: "salon", name: "Salon", tagline: "" }] }, { key: "other", label: "Other", options: [{ id: "other", name: "Other", tagline: "" }] }];
const OWNER = { groups: GROUPS, typeWords: TYPE_WORDS, otherId: "other", type: "salon", typeLabel: "", phone: "+91 98765 43210" };

describe("Business as sentences (JOBS)", () => {
  const draw = (over: Partial<Parameters<typeof BusinessSimple>[0]> = {}, action = vi.fn(async () => ({ ok: true as const }))) => {
    render(<BusinessSimple variant="page" words={words} action={action} name="Pavers Corner" town="Guntur" languages={["en", "te"]} choices={BUSINESS_LANGUAGES} canEdit owner={OWNER} {...over} />);
    return action;
  };
  it("reads as sentences with the choice inside, and says what it will do", () => {
    draw();
    expect(said(line("name"))).toBe("My business is called Pavers Corner.");
    expect(said(line("city"))).toBe("It is in Guntur.");
    expect(line("langs")).toHaveTextContent("I talk to my customers in English and తెలుగు.");
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("What it will do: Customers will see Pavers Corner in your messages and calls, and your assistant will talk to them in English and తెలుగు.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet
  });
  it("the effect line follows what is typed and what is ticked", async () => {
    draw();
    await type(/My business is called/, "Glow Salon");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /I talk to my customers in/ })));
    await act(async () => void fireEvent.click(screen.getByRole("checkbox", { name: "हिन्दी" })));
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("Customers will see Glow Salon in your messages and calls, and your assistant will talk to them in English, తెలుగు and हिन्दी.");
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
  it("keeps at least one language on", async () => {
    draw({ languages: ["en"] });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /I talk to my customers in/ })));
    expect(screen.getByRole("checkbox", { name: "English" })).toBeDisabled();
  });
  it("sends the SAME form as the old Business form (name, city, languages, the Owner's kind and phone)", async () => {
    const oldAction = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: true as const }));
    render(<BusinessForm action={oldAction} words={words} name="Pavers Corner" town="Guntur" languages={["en", "te"]} choices={CALL_LANGS} owner={OWNER} />);
    await type("Business name", "Glow Salon");
    await type("City or area", "Vijayawada");
    await type("Business phone", "+91 90000 00000");
    await submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(oldAction).toHaveBeenCalled());
    cleanup();
    const action = draw();
    await type(/My business is called/, "Glow Salon");
    await type(/It is in/, "Vijayawada");
    await type(/Customers can call me on/, "+91 90000 00000");
    await submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(entries((action.mock.calls[0] as unknown[])[1] as FormData)).toEqual(entries(oldAction.mock.calls[0][1]));
    expect(await screen.findByText("Saved. The new name shows everywhere now.")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
  it("shows the refusal in the old closed sentence, and keeps what was typed", async () => {
    draw({}, vi.fn(async () => ({ ok: false as const, error: "type_pack_data_present" })) as never);
    await type(/My business is called/, "Glow Salon");
    await submit(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This business already has records of its own kind");
    expect(screen.getByLabelText(/My business is called/)).toHaveValue("Glow Salon");
  });
  it("an Admin sees neither the kind nor the phone", () => {
    draw({ owner: null });
    expect(screen.queryByText("Customers can call me on")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("someone who may not change it reads the sentences without choices", () => {
    draw({ canEdit: false, owner: null });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(line("name")).toHaveTextContent("My business is called Pavers Corner.");
  });
  const addr = { line: "12-4-56, Gandhi Road", area: "Brodipet", pincode: "522002" };
  it("the card of the Settings page sends the SAME form as the old card (name, city, address, the languages as they are)", async () => {
    const oldSave = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: true as const }));
    render(<BusinessCardV6 words={words} name="Pavers Corner" city="Guntur" address={addr} canEdit canEditAddress languages={["en", "te"]} save={oldSave} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /Edit/ })));
    await type("Business name", "Glow Salon");
    await type("PIN code", "522003");
    await submit(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(oldSave).toHaveBeenCalled());
    cleanup();
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<BusinessSimple variant="card" words={words} action={save} name="Pavers Corner" town="Guntur" languages={["en", "te"]} choices={BUSINESS_LANGUAGES} canEdit canEditAddress address={addr} />);
    expect(said(line("address"))).toBe("My shop is at 12-4-56, Gandhi Road in Brodipet, PIN code 522002.");
    expect(line("langs")).toBeNull(); // the card keeps the languages as they are
    await type(/My business is called/, "Glow Salon");
    await type(/PIN code …\. \(3\)/, "522003");
    await submit(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(entries((save.mock.calls[0] as unknown[])[1] as FormData)).toEqual(entries(oldSave.mock.calls[0][1]));
    expect(await screen.findByText("Published. Your new details show everywhere now.")).toBeInTheDocument();
  });
  it("on the card only the Owner has the address to change; an Admin reads it", () => {
    draw({ variant: "card", choices: BUSINESS_LANGUAGES, address: addr, canEditAddress: false, owner: null });
    expect(screen.queryByLabelText(/My shop is at/)).toBeNull();
    expect(said(line("address"))).toBe("My shop is at 12-4-56, Gandhi Road in Brodipet, PIN code 522002.");
  });
  it("the rows given to the card are under More choices", () => {
    draw({ variant: "card", choices: BUSINESS_LANGUAGES, owner: null, children: <p>Shop timings row</p> });
    const more = document.querySelector("[data-part=more-choices]") as HTMLElement;
    expect(more).toHaveTextContent("More choices");
    expect(more).toHaveTextContent("Shop timings row");
  });
});

describe("Language and theme as sentences (JOBS)", () => {
  const assistant = (save: unknown = vi.fn(async () => ({ ok: true as const }))) => ({ name: "Pavers Corner", town: "Guntur", languages: ["te", "en"], choices: BUSINESS_LANGUAGES, save: save as never });
  it("reads: the app speaks, my assistant speaks to customers in, the app looks", () => {
    render(<LanguageSimple words={words} lang="te" theme="dark" assistant={assistant()} />);
    expect(said(line("app"))).toBe("The app speaks తెలుగు.");
    expect(line("assistant")).toHaveTextContent("My assistant speaks to customers in English and తెలుగు.");
    expect(said(line("theme"))).toBe("The app looks dark.");
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("The app will show in తెలుగు and look dark. Your assistant will talk to customers in English and తెలుగు.");
  });
  it("the app's language answers at once: the cookie, then the page is read again (as the old control did)", async () => {
    render(<LanguageSimple words={words} lang="en" theme="system" assistant={null} />);
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "The app speaks …." }), { target: { value: "hi" } }));
    expect(document.cookie).toContain("sme_lang=hi");
    expect(refresh).toHaveBeenCalled();
    expect(line("assistant")).toBeNull(); // the business could not be read: no sentence invented
  });
  it("the look answers at once and the effect line follows", async () => {
    render(<LanguageSimple words={words} lang="en" theme="system" assistant={null} />);
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "The app looks …." }), { target: { value: "dark" } }));
    expect(document.cookie).toContain("sme_theme=dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("The app will show in English and look dark.");
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "The app looks …." }), { target: { value: "system" } }));
    expect(document.cookie).not.toContain("sme_theme=dark");
  });
  it("the assistant's languages are saved with ONE Save, through the Business action with the name and city as they are", async () => {
    const save = vi.fn(async (_p: unknown, _f: FormData) => ({ ok: true as const }));
    render(<LanguageSimple words={words} lang="en" theme="system" assistant={assistant(save)} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /My assistant speaks to customers in/ })));
    await act(async () => void fireEvent.click(screen.getByRole("checkbox", { name: "हिन्दी" })));
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    await submit(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(entries(save.mock.calls[0][1])).toEqual([["languages", "en"], ["languages", "hi"], ["languages", "te"], ["name", "Pavers Corner"], ["town", "Guntur"]].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])));
    expect(await screen.findByText("Saved. Your assistant will use these languages from now on.")).toBeInTheDocument();
  });
  it("a refusal shows the old closed sentence", async () => {
    render(<LanguageSimple words={words} lang="en" theme="system" assistant={assistant(vi.fn(async () => ({ ok: false as const, error: "role" })))} />);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: /My assistant speaks to customers in/ })));
    await act(async () => void fireEvent.click(screen.getByRole("checkbox", { name: "हिन्दी" })));
    await submit(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Owner or an Admin can change this.");
  });
  it("someone who may not change the business reads the assistant's languages without a choice and without Save", () => {
    render(<LanguageSimple words={words} lang="en" theme="system" assistant={{ ...assistant(), save: null }} />);
    expect(line("assistant")).toHaveTextContent("My assistant speaks to customers in English and తెలుగు.");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: /My assistant speaks/ })).toBeNull();
  });
});

describe("Notifications as sentences (JOBS)", () => {
  const original = (globalThis as { Notification?: unknown }).Notification;
  afterEach(() => {
    (globalThis as { Notification?: unknown }).Notification = original;
    window.localStorage.clear();
  });
  const fake = (permission: string) => {
    const N = Object.assign(vi.fn(), { permission, requestPermission: vi.fn(async () => { N.permission = "granted"; return "granted"; }) });
    (globalThis as { Notification?: unknown }).Notification = N;
    return N;
  };
  it("a browser that cannot show notifications says so in words and the choice stays 'no'", () => {
    (globalThis as { Notification?: unknown }).Notification = undefined;
    render(<NotificationsSimple words={words} />);
    expect(screen.getByRole("combobox", { name: /Tell me on this device when a call starts/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("This browser can't show notifications.");
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("Nothing will pop up on this device when a call starts.");
  });
  it("turning calls on asks the browser from that tap, remembers it on this device, and the effect line says what will happen", async () => {
    const N = fake("default");
    render(<NotificationsSimple words={words} />);
    expect(screen.getByRole("status")).toHaveTextContent("Your browser will ask you once when you turn this on.");
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /Tell me on this device when a call starts/ }), { target: { value: "on" } }));
    await waitFor(() => expect(N.requestPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.localStorage.getItem("sme-notify-calls")).toBe("on"));
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("this device will show who is calling and where they came from, never a phone number.");
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /Tell me on this device when a call starts/ }), { target: { value: "off" } }));
    expect(window.localStorage.getItem("sme-notify-calls")).toBe("off");
  });
  it("a blocked browser cannot be turned on, and says how to allow it", () => {
    fake("denied");
    render(<NotificationsSimple words={words} />);
    expect(screen.getByRole("combobox", { name: /Tell me on this device when a call starts/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Blocked in this browser.");
  });
  it("the buzz sentence is there only where the device can buzz", () => {
    fake("granted");
    const nav = navigator as Navigator & { vibrate?: unknown };
    const had = nav.vibrate;
    nav.vibrate = () => true;
    try {
      render(<NotificationsSimple words={words} />);
      expect(line("feel")).toHaveTextContent("Buzz and play a soft sound when my assistant starts listening, is done or needs me");
    } finally {
      nav.vibrate = had;
    }
    cleanup();
    render(<NotificationsSimple words={words} />);
    expect(line("feel")).toBeNull();
  });
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number, over: Partial<Member> = {}): Member => ({ user_id: U(n), display_name: `Person ${n}`, role: "sales", joined_at: "2026-10-01T10:00:00Z", is_you: false, ...over });
const inv = (): never => ({ id: U(90), role: "sales", label: "for the cutter", status: "pending", created_at: "2026-10-12T10:00:00Z", expires_at: "2026-10-19T10:00:00Z", accepted_at: null, revoked_at: null }) as never;
const fail = (kind: string, code?: string) => ({ ok: false as const, kind: kind as never, error: "", ...(code ? { code } : {}) });
const actions = (over: Partial<TeamActions> = {}): TeamActions => ({
  invite: vi.fn(async () => ({ ok: true as const, data: { ...(inv() as object), code: "7QX2K-M9R4D-0A1B2-C3D4E", replayed: false } as never })),
  revoke: vi.fn(),
  changeRole: vi.fn(async (_u: string, role: string) => ({ ok: true as const, data: { user_id: U(2), role: role as never, changed: true } })),
  remove: vi.fn(async () => ({ ok: true as const, data: { user_id: U(2), leads_unassigned: 3, opportunities_unassigned: 1, runs_cancelled: 0, invitations_revoked: 0 } })),
  ...over,
});
const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

describe("Team as sentences (JOBS)", () => {
  const team = [member(1, { role: "owner", display_name: "Asha", is_you: true }), member(2, { display_name: "Ramesh" }), member(3, { role: "admin", display_name: "Ravi" })];
  it("each person is one sentence with the choice inside; the owner and yourself have none to change", () => {
    render(<TeamMembersSimple words={words} members={team} myRole="owner" actions={actions()} />);
    const lines = Array.from(document.querySelectorAll("[data-setting-line='member']")).map((l) => said(l));
    expect(lines).toEqual(["You are the owner.", "Ramesh can work with customers.", "Ravi can run the business."]);
    expect(screen.getByRole("combobox", { name: "Ramesh: Role" })).toHaveValue("sales");
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });
  it("an Admin changes neither another Admin nor the owner: the role is only read", () => {
    render(<TeamMembersSimple words={words} members={[member(1, { role: "owner", display_name: "Asha" }), member(3, { role: "admin", display_name: "Ravi" }), member(4, { role: "viewer", display_name: "Mina" })]} myRole="admin" actions={actions()} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Mina: Role" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
  });
  it("choosing another job says what will happen and changes it with the SAME action as the old card", async () => {
    const a = actions();
    render(<TeamMembersSimple words={words} members={team} myRole="owner" actions={a} />);
    expect(screen.queryByRole("button", { name: "Change role" })).toBeNull();
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Ramesh: Role" }), { target: { value: "viewer" } }));
    expect(screen.getByText(/Ramesh will be able to look, but not change anything\./)).toBeInTheDocument();
    await press("Change role");
    expect(a.changeRole).toHaveBeenCalledWith(U(2), "viewer");
    expect(await screen.findByText("Role changed.")).toBeInTheDocument();
    expect(said(document.querySelectorAll("[data-setting-line='member']")[1])).toBe("Ramesh can only look, not change.");
  });
  it("a refusal (the second step) shows the sentence and the way to Security", async () => {
    render(<TeamMembersSimple words={words} members={team} myRole="owner" actions={actions({ changeRole: vi.fn(async () => fail("mfa")) })} />);
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Ramesh: Role" }), { target: { value: "viewer" } }));
    await press("Change role");
    expect(await screen.findByRole("alert")).toHaveTextContent(/two-step|second/i);
    expect(screen.getByRole("link", { name: /Security|two-step/i })).toHaveAttribute("href", "/app/security");
  });
  it("Remove asks first, with a reason, and sends the same reason as the old card; it says what was tidied", async () => {
    const a = actions();
    render(<TeamMembersSimple words={words} members={team} myRole="owner" actions={a} />);
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]));
    expect(screen.getByText("Remove Ramesh from this business? They lose access at once.")).toBeInTheDocument();
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: "Why?" }), { target: { value: "security_concern" } }));
    await press("Yes, remove");
    expect(a.remove).toHaveBeenCalledWith(U(2), "security_concern");
    expect(await screen.findByText("Removed. 3 leads and 1 opportunities now have no owner; 0 agent tasks were stopped.")).toBeInTheDocument();
    expect(screen.queryByText(/Ramesh can/)).toBeNull();
  });
  it("leaving is the person's own line, with the old confirmation; the owner cannot leave", async () => {
    const a = actions();
    render(<TeamMembersSimple words={words} members={[member(1, { role: "owner", is_you: true }), member(2, { role: "sales", is_you: true, display_name: "Me" })]} myRole="sales" actions={a} />);
    expect(screen.getAllByRole("button", { name: /Leave this business/ })).toHaveLength(1);
    await press("Leave this business");
    await press("Yes, leave");
    expect(a.remove).toHaveBeenCalledWith(U(2), "left");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app"));
  });
  it("matches the old card on what may be done, for every role", () => {
    for (const myRole of ["owner", "admin", "sales", "viewer"]) {
      cleanup();
      const members = [member(1, { role: "owner" }), member(2, { role: "admin" }), member(3, { role: "sales" }), member(4, { role: "viewer" }), member(5, { role: "sales", is_you: true })];
      render(<TeamMembers words={words} members={members} myRole={myRole} actions={actions()} />);
      const old = [screen.queryAllByRole("combobox").length, screen.queryAllByRole("button", { name: /Remove|Leave/ }).length];
      cleanup();
      render(<TeamMembersSimple words={words} members={members} myRole={myRole} actions={actions()} />);
      expect([screen.queryAllByRole("combobox").length, screen.queryAllByRole("button", { name: /Remove|Leave/ }).length]).toEqual(old);
    }
  });
});

describe("Invite a person as sentences (JOBS)", () => {
  it("reads as sentences and says what the code will do", async () => {
    render(<InviteSimple words={words} myRole="owner" workspaceName="Acme Silks" actions={actions()} />);
    expect(said(line("invite-role"))).toBe("Invite someone as Sales.");
    expect(said(line("invite-days"))).toBe("The code works for 7 days.");
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("A one-time code that works for 7 days. The person you give it to will be able to work with customers: leads, quotes, orders and messages. Nothing is sent from here: you pass the code on yourself.");
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /Invite someone as/ }), { target: { value: "viewer" } }));
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /The code works for/ }), { target: { value: "30" } }));
    expect(document.querySelector("[data-part=effect]")).toHaveTextContent("works for 30 days. The person you give it to will be able to look, but not change anything.");
  });
  it("makes the code with the SAME call as the old form and shows it once, with the ways to pass it on by hand", async () => {
    const oldA = actions();
    render(<InviteForm words={words} myRole="owner" workspaceName="Acme Silks" actions={oldA} />);
    await act(async () => void fireEvent.change(screen.getByLabelText("Role"), { target: { value: "viewer" } }));
    await act(async () => void fireEvent.change(screen.getByLabelText("The code works for"), { target: { value: "14" } }));
    await act(async () => void fireEvent.change(screen.getByLabelText(/Label/), { target: { value: "for the cutter" } }));
    await press("Make an invitation code");
    cleanup();
    const a = actions();
    render(<InviteSimple words={words} myRole="owner" workspaceName="Acme Silks" actions={a} />);
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /Invite someone as/ }), { target: { value: "viewer" } }));
    await act(async () => void fireEvent.change(screen.getByRole("combobox", { name: /The code works for/ }), { target: { value: "14" } }));
    await type(/I will remember it as/, "for the cutter");
    await press("Make an invitation code");
    expect((a.invite as ReturnType<typeof vi.fn>).mock.calls[0].slice(1)).toEqual((oldA.invite as ReturnType<typeof vi.fn>).mock.calls[0].slice(1));
    expect(await screen.findByText("7QX2K-M9R4D-0A1B2-C3D4E")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send by WhatsApp" })).toBeInTheDocument();
    expect(screen.getByText("Nothing is sent from here. You pass the code on yourself.")).toBeInTheDocument();
  });
  it("a label with a phone number or an e-mail address is stopped before asking", async () => {
    const a = actions();
    render(<InviteSimple words={words} myRole="owner" workspaceName="Acme" actions={a} />);
    await type(/I will remember it as/, "call 9876543210");
    await press("Make an invitation code");
    expect(screen.getByRole("alert")).toHaveTextContent("Take out the phone number or e-mail address");
    expect(a.invite).not.toHaveBeenCalled();
  });
  it("an Admin invites Sales or Viewer only; a person with no right to invite sees nothing", () => {
    render(<InviteSimple words={words} myRole="admin" workspaceName="Acme" actions={actions()} />);
    expect(within(screen.getByRole("combobox", { name: /Invite someone as/ })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sales", "Viewer"]);
    cleanup();
    const { container } = render(<InviteSimple words={words} myRole="sales" workspaceName="Acme" actions={actions()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("a refusal shows its closed sentence", async () => {
    render(<InviteSimple words={words} myRole="owner" workspaceName="Acme" actions={actions({ invite: vi.fn(async () => fail("conflict", "too_many_invitations")) })} />);
    await press("Make an invitation code");
    expect(await screen.findByRole("alert")).toHaveTextContent("20 invitations are waiting.");
  });
});

describe("the Settings page cards (JOBS)", () => {
  const DATA: SettingsV6Data = {
    business: { name: "Lakshmi Sarees", city: "Hyderabad", phone: null, addressLine: "12-4-56, Gandhi Road", area: "Dharmavaram", pincode: "515671", languages: ["te", "en"], logoUrl: null },
    gstin: "36AABCU9603R1ZX",
    team: [{ name: "Lakshmi", role: "owner", you: true }, { name: "Ravi", role: "admin", you: false }, { name: null, role: "sales", you: false }],
    whatsapp: null, templates: null, sources: null, phone: null, hours: null, developer: null,
  };
  const props = (over: Partial<SettingsV6Props> = {}): SettingsV6Props => ({ words: appDict("en") as Record<string, string>, lang: "en", base: "/app/tenants/t1", title: "Settings", help: <button type="button">?</button>, admin: true, owner: true, data: DATA, tenantName: "Lakshmi Sarees", theme: "system", langLabel: "Language", notificationsHref: "/app/tenants/t1/settings?section=notifications", save: async () => ({ ok: true }), ...over });
  const card = (part: string) => document.querySelector(`[data-part="${part}"]`) as HTMLElement;
  it("JOBS off: the cards are as they were (Edit buttons, no sentences)", () => {
    render(<SettingsV6 {...props()} />);
    expect(screen.getByRole("link", { name: "Edit Team" })).toBeInTheDocument();
    expect(screen.queryByText("What it will do:")).toBeNull();
    expect(card("settings-business").querySelector("[data-part=business-simple]")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).slice(0, 2)).toEqual(["Business", "Team"]);
  });
  it("JOBS on: Business, Team, Notifications and Language and theme are sentences, with the same titles in the same places", () => {
    render(<SettingsV6 {...props({ simple: true })} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Business", "Team", "Quotes", "Connections", "Notifications", "Language and theme", "Privacy and data", "Privacy and legal", "Developer API keys"]);
    expect(card("settings-business")).toHaveTextContent("My business is called");
    expect(within(card("settings-team")).getAllByRole("listitem").map((l) => said(l))).toEqual(["You are the owner.", "Ravi can run the business.", "A team member can work with customers."]);
    expect(within(card("settings-team")).getByRole("link", { name: "Add or change people" })).toHaveAttribute("href", "/app/tenants/t1/team");
    expect(card("settings-team").querySelector("[data-part=more-choices]")).toHaveTextContent("Who can approve quotes");
    expect(card("settings-notifications")).toHaveTextContent("Tell me on this device when a call starts");
    expect(card("settings-language")).toHaveTextContent("The app speaks");
    // at most 4 choices a card in view; the rest under More choices
    expect(card("settings-business").querySelectorAll("[data-part=more-choices]")).toHaveLength(1);
  });
  it("JOBS on, with Notifications not on: the old card (no sentences)", () => {
    render(<SettingsV6 {...props({ simple: true, notificationsHref: null })} />);
    expect(card("settings-notifications")).not.toHaveTextContent("Tell me on this device");
  });
  it("JOBS on, a person who cannot change the business reads it (no field, no Save) and still sets the app's language and look", () => {
    render(<SettingsV6 {...props({ simple: true, admin: false, owner: false })} />);
    expect(within(card("settings-business")).queryByRole("textbox")).toBeNull();
    expect(within(card("settings-language")).getByRole("combobox", { name: "The app looks …." })).toBeInTheDocument();
    expect(within(card("settings-language")).queryByRole("button", { name: "Save" })).toBeNull();
  });
});
