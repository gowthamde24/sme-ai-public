import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";
import type { AudioIO, SocketLike } from "@/lib/browser-voice/client";
import { CALL_LANG_NAMES } from "@/lib/assistant/types";
import { PREVIEW_JSON, SECRET_JSON } from "@/lib/assistant-work/fixtures";

import type { AskEvent, AskRequest } from "../ask-types";
import { ChatPanel } from "../ChatPanel";
import { useAskSession, type AskSession } from "../use-ask-session";
import type { WorkOptions } from "./use-chat-work";

// the made-up answers are a chunk of their own (loaded on first use): loaded once here, so each test sees answers at the pace it expects
beforeAll(async () => void (await import("@/lib/assistant-work/fixture-transport")));

// the browser's made-up answers without their pauses
vi.mock("@/lib/assistant-work/client", async (orig) => {
  const real = await orig<typeof import("@/lib/assistant-work/client")>();
  return { ...real, fixtureTransport: (o: Parameters<typeof real.fixtureTransport>[0] = {}, p?: Parameters<typeof real.fixtureTransport>[1]) => real.fixtureTransport({ ...o, delay: 0 }, p) };
});
// the chat loads its cards on demand (LazyWorkCards): here they are the cards themselves (with the props recorder below)
vi.mock("./LazyWorkCards", async () => ({ WorkCards: (await import("./WorkCards")).WorkCards }));
// every set of props the thread hands to the work cards, as text (the secret must never be in one)
const cardProps: string[] = [];
vi.mock("./WorkCards", async (orig) => {
  const real = await orig<typeof import("./WorkCards")>();
  return { WorkCards: (props: Parameters<typeof real.WorkCards>[0]) => (cardProps.push(JSON.stringify(props.cards)), real.WorkCards(props)) };
});

const WORDS = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("bv.")));
const audio = (): AudioIO => ({ startMic: async () => undefined, stopMic: () => undefined, play: () => undefined, flush: () => undefined, playing: () => false, close: () => undefined, analyser: () => null });
const socket = (): SocketLike => ({ binaryType: "", readyState: 1, send: () => undefined, close: () => undefined, onopen: null, onmessage: null, onclose: null, onerror: null });
const CONV = "55555555-5555-4555-8555-555555555555";
const requests: AskRequest[] = [];
let session: AskSession | null = null;

async function* answer(question: string): AsyncGenerator<AskEvent> {
  if (question === "set up indiamart") yield { type: "work_card", card: SECRET_JSON };
  else if (question.includes("leads-guntur-nov.xlsx") || question === "add these to my leads") yield { type: "work_card", card: PREVIEW_JSON };
  else if (question === "bad card") yield { type: "work_card", card: { kind: "launch_rockets" } };
  else yield { type: "text", delta: "Fine." };
  yield { type: "done", conversationId: CONV };
}

function Harness({ work }: { work?: WorkOptions }) {
  const s = useAskSession({ lang: "en", base: "/app/tenants/t", words: { "ask.sorry": "Sorry", "ask.retry": "Try again" }, availability: "live", transport: (r) => (requests.push(r), answer(r.question)), voiceStatus: { available: false, speech: false } });
  React.useEffect(() => {
    session = s;
  });
  return <ChatPanel session={s} chips={[]} voice={{ words: WORDS, url: "wss://x/v", language: "en", languageNames: CALL_LANG_NAMES, tokenUrl: "/t", ...(work ? { work } : {}) }} variant="card" onClose={() => undefined} voiceOptions={{ audioFactory: audio, socketFactory: socket }} />;
}
const typeAndSend = async (text: string) => {
  await act(async () => void fireEvent.change(screen.getByLabelText("Type, dictate, or go Live"), { target: { value: text } }));
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
};
const openPlus = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: WORDS["bv.bar.plus"] })));
const fileInput = () => document.querySelector<HTMLInputElement>("[data-chat=file-input]");
const pick = async (...files: File[]) => act(async () => void fireEvent.change(fileInput() as HTMLInputElement, { target: { files } }));
const bigFile = (name: string, bytes: number) => {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: bytes });
  return f;
};

beforeEach(() => {
  requests.length = 0;
  cardProps.length = 0;
  session = null;
});
afterEach(cleanup);

describe("the chat without the feature", () => {
  it("has no 'Add a file', no file input and no drop zone, and draws no work card", async () => {
    render(<Harness />);
    await openPlus();
    expect(screen.queryByRole("menuitem", { name: "Add a file" })).toBeNull();
    expect(fileInput()).toBeNull();
    await typeAndSend("add these to my leads");
    expect(document.querySelector("[data-work]")).toBeNull();
  });
});

describe("files in the chat", () => {
  it("the + menu has 'Add a file'; a picked file becomes a chip with its name, size, progress and a remove button", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await openPlus();
    const item = screen.getByRole("menuitem", { name: "Add a file" });
    // first in the menu, before New conversation and Earlier conversations (owner, 5 Nov)
    expect(screen.getAllByRole("menuitem").map((m) => /^(Add a file|New conversation|Earlier conversations)/.exec(m.textContent ?? "")?.[1])).toEqual(["Add a file", "New conversation", "Earlier conversations"]);
    const click = vi.spyOn(fileInput() as HTMLInputElement, "click");
    await act(async () => void fireEvent.click(item));
    expect(click).toHaveBeenCalled();
    expect(fileInput()?.accept).toContain(".xlsx");
    expect(fileInput()?.accept).toContain(".vcf");
    await pick(new File(["Name,Phone\nLakshmi,9848"], "leads-guntur-nov.xlsx"));
    const chip = document.querySelector("[data-chat=file-chip]") as HTMLElement;
    expect(chip.dataset.status).toBe("ready");
    expect(chip.textContent).toContain("leads-guntur-nov.xlsx");
    expect(chip.textContent).toContain("B · Example mode: not uploaded");
    await act(async () => void fireEvent.click(within(chip).getByRole("button", { name: "Remove leads-guntur-nov.xlsx" })));
    expect(document.querySelector("[data-chat=file-chip]")).toBeNull();
  });
  it("refuses a file over 10 MB (the contract) and a kind it cannot read BEFORE any upload", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(bigFile("register-photo.jpg", 11 * 1024 * 1024), new File(["MZ"], "setup.exe"), new File(["x"], "old-rates.doc"));
    const refused = [...document.querySelectorAll("[data-chat=file-refused]")].map((x) => x.textContent);
    const typeWords = "this kind of file can’t be read. Use Excel, CSV, PDF, a photo (JPG, PNG, HEIC), Word (.docx), a contact card (.vcf) or a text file.";
    expect(refused).toEqual(["register-photo.jpg is bigger than 10 MB. Send a smaller file.", `setup.exe: ${typeWords}`, `old-rates.doc: ${typeWords}`]);
    expect(document.querySelector("[data-chat=file-chip]")).toBeNull();
  });
  it("the + menu says what it takes; the picker accepts PDF, photos (HEIC/HEIF too) and Word next to Excel, CSV and contact cards", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await openPlus();
    const item = screen.getByRole("menuitem", { name: "Add a file" });
    expect(item.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(item.getAttribute("aria-describedby") as string)?.textContent).toBe("Excel, CSV, PDF, photos (JPG, PNG, HEIC), Word, contact cards · up to 10\u00a0MB");
    const accept = (fileInput()?.accept ?? "").split(",");
    for (const x of [".xlsx", ".xls", ".csv", ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".docx", ".vcf", ".txt", "image/heic", "application/pdf"]) expect(accept).toContain(x);
  });
  it("a PDF, a phone's HEIC photo with an EMPTY type and a Word file become chips that say their kind", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(new File(["%PDF"], "brochure-diwali.pdf", { type: "application/pdf" }), new File(["x"], "IMG_2041.HEIC", { type: "" }), new File(["PK"], "rates.docx"));
    const chips = [...document.querySelectorAll<HTMLElement>("[data-chat=file-chip]")];
    expect(chips.map((c) => c.dataset.kind)).toEqual(["pdf", "image", "doc"]);
    expect(chips.map((c) => c.dataset.status)).toEqual(["ready", "ready", "ready"]);
    expect(chips[0].textContent).toContain("PDF · 4 B");
    expect(chips[1].textContent).toContain("Photo · 1 B");
    expect(chips[2].textContent).toContain("Word file · 2 B");
  });
  it("a PDF on its own: the contract's honest 'can't do yet' card and a sentence that says so, made in the browser (mock: nothing is sent)", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(new File(["%PDF"], "brochure-diwali.pdf", { type: "application/pdf" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(requests).toHaveLength(0);
    expect(document.querySelector("[data-chat=thread]")?.textContent).toContain("I can’t read PDFs, photos or Word files yet, so nothing was added from them.");
    const card = document.querySelector<HTMLElement>("[data-work=cant-do]") as HTMLElement;
    expect(card.dataset.reason).toBe("not_yet");
    expect(card.textContent).toContain("I can’t do this yet.");
    expect(card.textContent).toContain("Reading leads or details from brochure-diwali.pdf (PDF)");
    expect(within(card).getByRole("link", { name: "Open About my business" }).getAttribute("href")).toBe("/app/tenants/t/settings?section=assistant#knowledge");
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull(); // nothing pretends to be done
  });
  it("a sheet and a photo together: the sheet goes to the assistant; the photo's card comes after its answer", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(new File(["a"], "leads-guntur-nov.xlsx"), new File(["x"], "visiting-card.jpg", { type: "image/jpeg" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe("📎 leads-guntur-nov.xlsx\n📎 visiting-card.jpg");
    expect(screen.getByRole("article", { name: "What I found in leads-guntur-nov.xlsx" })).toBeTruthy();
    expect(document.querySelectorAll("[data-work=cant-do]")).toHaveLength(1);
    expect(document.querySelector("[data-work=cant-do]")?.textContent).toContain("visiting-card.jpg (Photo)");
  });
  it("typed words with a Word file: the words go to the assistant, and the file still gets its honest card", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(new File(["PK"], "rates.docx"));
    await typeAndSend("what is in this?");
    expect(requests.map((r) => r.question)).toEqual(["what is in this?"]);
    expect(document.querySelector("[data-work=cant-do]")?.textContent).toContain("rates.docx (Word file)");
  });
  it("a file dropped on the composer is taken; a drag without files is not", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    const form = document.querySelector("[data-chat=form]") as HTMLElement;
    await act(async () => void fireEvent.dragOver(form, { dataTransfer: { types: ["Files"], files: [] } }));
    expect(screen.getByText("Drop the file here")).toBeTruthy();
    await act(async () => void fireEvent.drop(form, { dataTransfer: { types: ["Files"], files: [new File(["BEGIN:VCARD"], "ravi.vcf")] } }));
    expect(document.querySelector("[data-chat=file-chip]")?.textContent).toContain("ravi.vcf");
    await act(async () => void fireEvent.drop(form, { dataTransfer: { types: ["text/plain"], files: [] } }));
    expect(document.querySelectorAll("[data-chat=file-chip]")).toHaveLength(1);
  });
  it("a file alone can be sent: the message names it; in mock mode no upload id goes with it", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await pick(new File(["a"], "leads-guntur-nov.xlsx"));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe("📎 leads-guntur-nov.xlsx");
    expect(requests[0].attachmentIds).toBeUndefined();
    expect(document.querySelector("[data-chat=file-chip]")).toBeNull();
    expect(screen.getByRole("article", { name: "What I found in leads-guntur-nov.xlsx" })).toBeTruthy();
  });
});

describe("work cards in the thread", () => {
  it("an answer's preview card stays (and remembers it ran) when the thread moves on", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await typeAndSend("add these to my leads");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Do it" })));
    expect(screen.getByText("Done")).toBeTruthy();
    await typeAndSend("thanks");
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Do it" })).toBeNull();
  });
  it("a card that does not parse is not drawn (and the answer is not an empty bubble: it says sorry)", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await typeAndSend("bad card");
    expect(document.querySelector("[data-work=cards]")).toBeNull();
    expect(document.querySelector("[data-chat=failed]")?.textContent).toBe("Sorry");
  });
  it("A KEY TYPED IN THE SECURE BOX NEVER REACHES THE TRANSCRIPT, THE SESSION OR THE PROPS OF THE THREAD", async () => {
    const KEY = "IM-CRM-7f3c9a1e55b2-4021";
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await typeAndSend("set up indiamart");
    const input = screen.getByLabelText("IndiaMART CRM key") as HTMLInputElement;
    await act(async () => void fireEvent.change(input, { target: { value: KEY } }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Save securely" })));
    expect(screen.getByText("Saved · ••••4021")).toBeTruthy();
    await typeAndSend("done?");
    const thread = document.querySelector("[data-chat=thread]") as HTMLElement;
    expect(thread.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(document.body.innerHTML).not.toContain("7f3c9a1e");
    expect(cardProps.length).toBeGreaterThan(0);
    for (const p of cardProps) expect(p).not.toContain(KEY);
    expect(JSON.stringify(session?.earlier)).not.toContain(KEY);
    expect(JSON.stringify(session?.work)).not.toContain(KEY);
    expect(requests.map((r) => r.question).join("|")).not.toContain(KEY);
    expect((screen.getByLabelText("Type, dictate, or go Live") as HTMLTextAreaElement).value).not.toContain(KEY);
  });
  it("Change puts the words in the composer", async () => {
    render(<Harness work={{ mode: "mock", role: "owner" }} />);
    await typeAndSend("add these to my leads");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Change" })));
    expect((screen.getByLabelText("Type, dictate, or go Live") as HTMLTextAreaElement).value).toBe("Change the plan: ");
  });
  it("Staff see the plan of a sensitive card without its button (roles come from the layout)", async () => {
    render(<Harness work={{ mode: "mock", role: "sales" }} />);
    await typeAndSend("set up indiamart");
    expect(screen.getByText("Only the owner can save keys.")).toBeTruthy();
    expect(screen.queryByLabelText("IndiaMART CRM key")).toBeNull();
  });
});
