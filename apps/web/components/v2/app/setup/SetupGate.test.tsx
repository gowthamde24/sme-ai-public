import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { SetupGate } from "./SetupGate";
import { NEW_LOCAL } from "./setup-logic";
import { readLocal, resetSetupStore, writeLocal } from "./setup-store";
import { BASE, T, actions, defaultHours, fresh, words } from "./setup-test-kit";
import type { SetupActions, SetupFacts } from "./types";
import type { Uploader } from "../catalogue/catalogue-types";

const savedHours = { settings: { ...defaultHours, is_default: false }, saved: true };
const TODAY = <div data-testid="today">Today</div>;
const png = () => new File([new Uint8Array(2000)], "saree.png", { type: "image/png" });
const okUpload: Uploader = async (_f, _id, progress) => {
  progress(50);
  return { ok: true, photo: { id: "p" } as never, photos: [] };
};
const prepared = async (f: File) => ({ ok: true as const, blob: f });

function gate(facts: SetupFacts, act: SetupActions = actions(), extra: { uploader?: Uploader; lang?: "en" | "te" } = {}) {
  return render(
    <SetupGate tenantId={T} base={BASE} lang={extra.lang ?? "en"} facts={facts} words={words} actions={act} uploader={extra.uploader ?? okUpload} prepare={prepared as never}>
      {TODAY}
    </SetupGate>,
  );
}
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

beforeEach(() => {
  window.localStorage.clear();
  resetSetupStore();
  refresh.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("a new workspace sees the wizard instead of an empty Today (job BJ)", () => {
  it("shows step 1 of 4 with the shop's name and no Today behind it; every control is 44 px or more", () => {
    gate(fresh());
    expect(title()).toBe("Welcome to Asha Silks");
    expect(screen.getAllByText("Step 1 of 4").length).toBeGreaterThan(0); // shown, and said to a screen reader in the progress list
    expect(screen.queryByTestId("today")).toBeNull();
    expect(document.querySelector('[data-setup="wizard"]')).not.toBeNull();
    for (const b of screen.getAllByRole("button")) expect(b.className, b.textContent ?? "").toMatch(/min-h-11|size-11/);
    for (const r of screen.getAllByRole("radio")) expect(r.closest("label")!.className).toMatch(/min-h-11/);
  });
  it("the progress list names the steps for a screen reader and marks the current one", () => {
    gate(fresh());
    const list = screen.getByRole("list", { name: "Setup progress" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(list.querySelector('[aria-current="step"]')).toHaveTextContent("Step 1 of 4");
  });
  it("the step 1 language choice writes the language cookie and asks the page to be drawn again", () => {
    gate(fresh());
    fireEvent.click(screen.getByRole("radio", { name: "తెలుగు" }));
    expect(document.cookie).toContain("sme_lang=te");
    expect(refresh).toHaveBeenCalled();
    document.cookie = "sme_lang=; Path=/; Max-Age=0";
  });
});

describe("the order of the steps and what each saves", () => {
  it("shop → hours → saree → Agent OWL → ready, then Today with the checklist for what was skipped", async () => {
    const act = actions();
    gate(fresh(), act);
    next();
    expect(title()).toBe("When is the shop open?");
    expect(screen.getAllByText("Step 2 of 4").length).toBeGreaterThan(0);
    // the usual saree-shop hours are filled in: Monday to Saturday, 10:00 to 20:30, 30 minutes, 2 at once; Sunday is off
    for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) expect(screen.getByRole("checkbox", { name: new RegExp(d) })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Sunday/ })).not.toBeChecked();
    expect(screen.getByLabelText("Opens")).toHaveValue("10:00");
    expect(screen.getByLabelText("Closes")).toHaveValue("20:30");
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    expect(await screen.findByText(/Hours saved/)).toBeInTheDocument();
    expect(act.saved[0]).toEqual(["hours", { weekly_hours: { mon: { open: "10:00", close: "20:30" }, tue: { open: "10:00", close: "20:30" }, wed: { open: "10:00", close: "20:30" }, thu: { open: "10:00", close: "20:30" }, fri: { open: "10:00", close: "20:30" }, sat: { open: "10:00", close: "20:30" }, sun: null }, closed_dates: [], slot_minutes: 30, max_parallel: 2 }]);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull(); // done: nothing to skip
    next();
    expect(title()).toBe("Add your first saree");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(title()).toBe("Meet Agent OWL");
    expect(screen.getAllByText("Step 4 of 4").length).toBeGreaterThan(0);
    next();
    expect(title()).toBe("You're ready");
    expect(screen.queryByText(/Step \d of 4/)).toBeNull();
    const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Ask Agent OWL what needs you today→", BASE],
      ["Add more sarees→", `${BASE}/catalogue/new`],
      ["Add a customer→", `${BASE}?tab=companies`],
      ["Go to Today", BASE],
    ]);
    fireEvent.click(screen.getByRole("link", { name: "Go to Today" }));
    // finished: Today is back, with the checklist for the one thing skipped
    expect(screen.getByTestId("today")).toBeInTheDocument();
    const card = document.querySelector('[data-setup="checklist"]') as HTMLElement;
    expect(card).toHaveTextContent("2 of 3 done");
    expect(within(card).getByRole("button", { name: /Add your first saree/ })).toHaveTextContent("To do");
    expect(within(card).getByRole("button", { name: /Set the shop hours/ })).toHaveTextContent("Done");
  });
  it("Back goes to the step before, and the first step has no Back", () => {
    gate(fresh());
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(title()).toBe("Welcome to Asha Silks");
  });
  it("the Agent OWL step says what it does, what always waits (money, complaints, calls), that automatic sending is OFF with one plain sentence, and the quiet hours", () => {
    gate(fresh());
    next();
    next();
    next();
    expect(screen.getByText(/reads your records, answers your questions and prepares drafts/)).toBeInTheDocument();
    const waits = screen.getByRole("heading", { name: "What always waits for you" }).closest("div")!;
    expect(waits).toHaveAttribute("lang", "en");
    for (const t of ["Money: prices, discounts, advances and refunds", "Complaints", "Calls: Agent OWL asks you first"]) expect(within(waits).getByText(t)).toBeInTheDocument();
    const sending = document.querySelector('[data-setup="sending"]')!;
    expect(sending).toHaveTextContent("Automatic sending is off. New messages wait for you to approve them. You can switch it on later in Settings.");
    expect(sending).toHaveTextContent("Quiet hours: nothing goes out from 21:00 to 09:00 (India time).");
    expect(screen.getByRole("link", { name: "Open Agent OWL settings" })).toHaveAttribute("href", `${BASE}/settings?section=agent`);
    expect(readLocal(T).agentSeen).toBe(true);
  });
  it("when automatic sending is already on, the step says so instead (read from the API, not assumed)", () => {
    gate(fresh({ sending: { auto: true, quietStart: 20, quietEnd: 8, platformOn: true } }));
    next();
    next();
    next();
    expect(document.querySelector('[data-setup="sending"]')).toHaveTextContent(/On: routine replies go out by themselves/);
    expect(document.querySelector('[data-setup="sending"]')).toHaveTextContent("20:00 to 08:00");
  });
  it("when the outbox settings cannot be read the step still says automatic sending is off by default and invents no hours", () => {
    gate(fresh({ sending: null }));
    next();
    next();
    next();
    const s = document.querySelector('[data-setup="sending"]')!;
    expect(s).toHaveTextContent("Automatic sending is off.");
    expect(s).not.toHaveTextContent("Quiet hours:");
  });
});

describe("the hours step", () => {
  const open = () => {
    gate(fresh());
    next();
  };
  it("the days, times and visit length go into the saved week; a closed day is null", async () => {
    const act = actions();
    gate(fresh(), act);
    next();
    fireEvent.click(screen.getByRole("checkbox", { name: /Sunday/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tuesday/ }));
    fireEvent.change(screen.getByLabelText("Opens"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "21:00" } });
    fireEvent.change(screen.getByLabelText("Length of one visit"), { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Visits at the same time"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    await screen.findByText(/Hours saved/);
    const sent = (act.saved[0] as [string, { weekly_hours: Record<string, unknown>; slot_minutes: number; max_parallel: number }])[1];
    expect(sent.weekly_hours.tue).toBeNull();
    expect(sent.weekly_hours.sun).toEqual({ open: "09:30", close: "21:00" });
    expect(sent.slot_minutes).toBe(45);
    expect(sent.max_parallel).toBe(4);
  });
  it("closing at or before opening, or no open day, is refused in words and sends nothing", () => {
    const act = actions();
    gate(fresh(), act);
    next();
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The closing time must be after the opening time.");
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "20:30" } });
    for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(d) }));
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one open day.");
    expect(act.saved).toHaveLength(0);
  });
  it("a refusal from the API is shown in our words, nothing is marked done, and the step can still be skipped", async () => {
    gate(fresh(), actions({ saveHours: async () => ({ ok: false, error: "Only the owner or an admin can change the hours." }) }));
    next();
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner or an admin can change the hours.");
    expect(readLocal(T).hoursDone).toBe(false);
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
  });
  it("double-press is one save: the button is off while it runs", async () => {
    let release!: () => void;
    const gateP = new Promise<void>((r) => (release = r));
    const act = actions({
      saveHours: async (s) => {
        await gateP;
        return { ok: true, message: "Hours saved.", settings: { ...s, is_default: false } };
      },
    });
    const spy = vi.spyOn(act, "saveHours");
    gate(fresh(), act);
    next();
    const save = screen.getByRole("button", { name: "Save the hours" });
    fireEvent.click(save);
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await act2(release);
    await screen.findByText("Hours saved.");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("starts from the hours the business already saved (not the usual ones)", () => {
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null } as const;
    const settings = { ...defaultHours, is_default: false, weekly_hours: { ...defaultHours.weekly_hours, ...closed, sun: { open: "11:00", close: "18:00" } }, slot_minutes: 60, max_parallel: 3 };
    gate(fresh({ hours: { settings, saved: true }, sarees: 0 }));
    writeLocal(T, { step: 1 });
    cleanup();
    resetSetupStore();
    window.localStorage.setItem(`sme.setup.v1.${T}`, JSON.stringify({ ...NEW_LOCAL, step: 1 }));
    gate(fresh({ hours: { settings, saved: true }, sarees: 0 }));
    expect(screen.getByRole("checkbox", { name: /Monday/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Sunday/ })).toBeChecked();
    expect(screen.getByLabelText("Opens")).toHaveValue("11:00");
    expect(screen.getByLabelText("Length of one visit")).toHaveValue("60");
    void open;
  });
});
const act2 = (fn: () => void) => act(async () => fn());

describe("the first saree step", () => {
  const toSaree = () => {
    next();
    next();
  };
  const pick = (f = png()) => fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [f] } });
  it("needs a photo first; the name follows the fabric and colour until the person writes their own", () => {
    const act = actions();
    gate(fresh(), act);
    toSaree();
    expect(screen.getByLabelText("Name")).toHaveValue("Maroon Kanchi pattu");
    fireEvent.change(screen.getByLabelText("Fabric"), { target: { value: "banarasi" } });
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "green" } });
    expect(screen.getByLabelText("Name")).toHaveValue("Green Banarasi");
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a photo first.");
    expect(act.saved).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My own name" } });
    fireEvent.change(screen.getByLabelText("Fabric"), { target: { value: "uppada" } });
    expect(screen.getByLabelText("Name")).toHaveValue("My own name");
  });
  it("saves the details hidden, uploads the photo, then shows the saree: the same order as the Catalogue form; one saree id for every try", async () => {
    const act = actions();
    const upload = vi.fn(okUpload);
    gate(fresh(), act, { uploader: upload });
    toSaree();
    pick();
    expect(URL.createObjectURL).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /rich/i }));
    fireEvent.change(screen.getByLabelText("Price range"), { target: { value: "5k_10k" } });
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(await screen.findByText(/Saree added/)).toBeInTheDocument();
    const [first, second] = act.saved as [string, string, Record<string, unknown>][];
    expect(first[1]).toBe(second[1]);
    expect(first[2]).toMatchObject({ name: "Maroon Kanchi pattu", fabric: "kanchi_pattu", colours: ["maroon"], zari: "rich", priceBand: "5k_10k", stockStatus: "in_stock", active: false });
    expect(second[2]).toMatchObject({ active: true });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(readLocal(T).sareeDone).toBe(true);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });
  it("a refusal of the details is said in our words and no photo is sent", async () => {
    const upload = vi.fn(okUpload);
    gate(fresh(), actions({ saveItem: async () => ({ ok: false, error: "Something in the form was not accepted. Check it and try again." }) }), { uploader: upload });
    toSaree();
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something in the form was not accepted.");
    expect(upload).not.toHaveBeenCalled();
    expect(readLocal(T).sareeDone).toBe(false);
  });
  it("a photo that fails keeps the details saved: the person is told to choose it again, and a retry does not save the details twice", async () => {
    const act = actions();
    const upload = vi.fn<Uploader>().mockResolvedValueOnce({ ok: false, code: "photo_too_large" }).mockImplementation(okUpload);
    gate(fresh(), act, { uploader: upload });
    toSaree();
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The details were saved, but the photo did not upload: This photo is bigger than 5 MB. Choose the photo again.");
    expect(act.saved).toHaveLength(1);
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    await screen.findByText(/Saree added/);
    expect(act.saved).toHaveLength(2); // the details once (the first try), then "shown" once (the retry): never the details twice
  });
  it("a photo the browser cannot use (not a picture) is refused before it travels", async () => {
    const upload = vi.fn(okUpload);
    const act = actions();
    render(
      <SetupGate tenantId={T} base={BASE} lang="en" facts={fresh()} words={words} actions={act} uploader={upload}>
        {TODAY}
      </SetupGate>,
    );
    toSaree();
    pick(new File(["x"], "a.txt", { type: "text/plain" }));
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use a JPEG, PNG or WebP photo.");
    expect(upload).not.toHaveBeenCalled();
  });
  it("a network drop while uploading is said in words", async () => {
    gate(fresh(), actions(), { uploader: async () => ({ ok: false, code: "network" }) });
    toSaree();
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Add this saree" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The connection dropped. Try again.");
  });
});

describe("resume, skip and the checklist", () => {
  it("closing the tab on step 3 and coming back resumes at step 3", () => {
    gate(fresh());
    next();
    next();
    expect(title()).toBe("Add your first saree");
    cleanup();
    resetSetupStore(); // a reload
    gate(fresh({ hours: savedHours })); // what was saved shows in the facts now
    expect(title()).toBe("Add your first saree");
    expect(screen.queryByTestId("today")).toBeNull();
  });
  it("'Set up later' leaves the wizard for Today with the checklist above it", () => {
    gate(fresh());
    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));
    expect(screen.getByTestId("today")).toBeInTheDocument();
    expect(document.querySelector('[data-setup="checklist"]')).toHaveTextContent("0 of 3 done");
    expect(readLocal(T).state).toBe("skipped");
  });
  it("'Continue setup' reopens the wizard at the first thing left, and finishing it removes the card when all is done", () => {
    gate(fresh({ hours: savedHours, sarees: 2 }));
    expect(document.querySelector('[data-setup="wizard"]')).toBeNull();
    const card = document.querySelector('[data-setup="checklist"]') as HTMLElement;
    expect(card).toHaveTextContent("2 of 3 done");
    fireEvent.click(within(card).getByRole("button", { name: "Continue setup" }));
    expect(title()).toBe("Meet Agent OWL");
    expect(readLocal(T).agentSeen).toBe(true);
    next();
    fireEvent.click(screen.getByRole("link", { name: "Go to Today" }));
    expect(document.querySelector('[data-setup="checklist"]')).toBeNull(); // everything is done: no card
    expect(screen.getByTestId("today")).toBeInTheDocument();
  });
  it("a row of the checklist opens that step; 'Hide' hides the card and this device remembers", () => {
    const { unmount } = gate(fresh({ hours: savedHours }));
    writeLocal(T, { state: "skipped" });
    const card = document.querySelector('[data-setup="checklist"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: /Add your first saree/ }));
    expect(title()).toBe("Add your first saree");
    fireEvent.click(screen.getByRole("button", { name: "Set up later" }));
    fireEvent.click(within(document.querySelector('[data-setup="checklist"]') as HTMLElement).getByRole("button", { name: "Hide the setup list" }));
    expect(document.querySelector('[data-setup="checklist"]')).toBeNull();
    expect(screen.getByTestId("today")).toBeInTheDocument();
    unmount();
    resetSetupStore();
    gate(fresh({ hours: savedHours }));
    expect(document.querySelector('[data-setup="checklist"]')).toBeNull();
  });
  it("an established workspace sees Today at once and the checklist card above it (never the wizard)", () => {
    gate(fresh({ hours: savedHours, sarees: 5 }));
    expect(screen.getByTestId("today")).toBeInTheDocument();
    expect(document.querySelector('[data-setup="checklist"]')).not.toBeNull();
    expect(document.querySelector('[data-setup="wizard"]')).toBeNull();
  });
  it("facts that could not be read show Today with no wizard", () => {
    gate(fresh({ hours: null, sarees: null }));
    expect(document.querySelector('[data-setup="wizard"]')).toBeNull();
    expect(screen.getByTestId("today")).toBeInTheDocument();
  });
  it("the checklist and the wizard are in the person's language (Telugu) and the money and consent lines stay English", async () => {
    const { setupWords } = await import("@/app/app/tenants/[tenantId]/setup-words");
    const te = setupWords("te");
    render(
      <SetupGate tenantId={T} base={BASE} lang="te" facts={fresh({ hours: savedHours, sarees: 1 })} words={te} actions={actions()}>
        {TODAY}
      </SetupGate>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(te["setup.check.title"]);
    expect(te["setup.s4.waits.money"]).toBe("Money: prices, discounts, advances and refunds");
    expect(te["setup.s4.auto"]).toBe(words["setup.s4.auto"]);
    expect(te["setup.s2.title"]).not.toBe(words["setup.s2.title"]);
  });
});
