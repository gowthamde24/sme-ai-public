import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));
vi.mock("../today/ask/recorder", () => ({ canRecord: () => true, MAX_SECONDS: 60 }));
// a recorder that records until `stop`, and the clock says how long it was
vi.mock("../today/ask/use-recorder", () => ({
  useRecorder: ({ onRecorded }: { onRecorded: (b: Blob) => void }) => {
    const [state, set] = React.useState<"idle" | "recording">("idle");
    return { state, left: 40, start: async () => set("recording"), stop: () => (set("idle"), onRecorded(new Blob(["sound"], { type: "audio/webm;codecs=opus" }))), cancel: () => set("idle") };
  },
}));

import { appDict } from "@/i18n/app";
import type { OwnVoice as Voice } from "@/lib/own-voice/types";

import { OwnVoice } from "./OwnVoice";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("ov.") || k.startsWith("today.err.") || k === "frame.notyet"));
const NONE: Voice = { status: "none", consentingName: null, consentedAt: null, sampleSeconds: null, consentSeconds: null, readyAt: null, deletedAt: null, saysAiAssistant: true, fake: true };
const READY: Voice = { ...NONE, status: "ready", consentingName: "Anil Reddy", consentedAt: "2026-10-26T05:00:00Z", readyAt: "2026-10-26T05:01:00Z" };
const SENTENCE = "I, Anil Reddy, allow Stack19 to create an AI voice of me for Sri Silks.";
const fetchMock = vi.fn();
const sentence = vi.fn(async () => SENTENCE as string | null);
const remove = vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; code: string; mfa?: boolean });
const draw = (voice: Voice = NONE, over: { canEdit?: boolean } = {}) => render(<OwnVoice words={words} voice={voice} canEdit={over.canEdit ?? true} endpoint="/app/tenants/T/own-voice" actions={{ sentence, remove }} />);
let now = 0;
const record = async (name: string, seconds: number) => {
  await act(async () => void fireEvent.click(screen.getByRole("button", { name })));
  now += seconds * 1000;
  vi.setSystemTime(now);
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop" })));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  now = Date.parse("2026-10-26T10:00:00Z");
  vi.setSystemTime(now);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
  fetchMock.mockReset();
  refresh.mockReset();
  sentence.mockClear();
  remove.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Use my own voice", () => {
  it("says what it does: a short sample and one sentence of consent; the assistant still says it is the AI assistant; the voice can be deleted; a fake voice is said to be fake", () => {
    draw();
    expect(screen.getByText(/It still says it is the AI assistant/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Test voice: no real voice is made yet.");
    expect(screen.getByText("Deleting removes the voice and both recordings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create my voice" })).toBeDisabled();
  });
  it("an Admin sees only that the Owner makes it", () => {
    draw(NONE, { canEdit: false });
    expect(screen.getByText("Only the Owner can make or delete the voice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create my voice" })).toBeNull();
  });
  it("the whole way: name, the sentence, the sentence recorded, the sample recorded, listened to, then created with both recordings, the lengths and the sentence", async () => {
    draw();
    const create = screen.getByRole("button", { name: "Create my voice" });
    expect(screen.getByRole("button", { name: "Show the sentence" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your full name (it is part of the consent)"), { target: { value: "Anil Reddy" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show the sentence" })));
    expect(sentence).toHaveBeenCalledWith("Anil Reddy");
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
    await record("Record the sentence", 6);
    await record("Record the sample", 21);
    expect(screen.getAllByLabelText("Listen")).toHaveLength(2);
    expect(screen.getByText("6 seconds recorded")).toBeInTheDocument();
    expect(screen.getByText("21 seconds recorded")).toBeInTheDocument();
    expect(create).toBeEnabled();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { status: "ready" } }), { status: 200 }));
    await act(async () => void fireEvent.click(create));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/app/tenants/T/own-voice");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ name: "Anil Reddy", consent_sentence: SENTENCE, sample_type: "audio/webm", consent_type: "audio/webm", sample_seconds: 21, consent_seconds: 6 });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.sample_base64).toBe(btoa("sound"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("a sample that is too short or too long is said at once and cannot be sent", async () => {
    draw();
    fireEvent.change(screen.getByLabelText("Your full name (it is part of the consent)"), { target: { value: "Anil Reddy" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show the sentence" })));
    await screen.findByText(SENTENCE);
    await record("Record the sentence", 6);
    await record("Record the sample", 9);
    expect(screen.getByRole("alert")).toHaveTextContent("The sample must be between 15 and 60 seconds.");
    expect(screen.getByRole("button", { name: "Create my voice" })).toBeDisabled();
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "Record again" }).at(-1)!));
    await record("Record the sample", 30);
    expect(screen.getByRole("button", { name: "Create my voice" })).toBeEnabled();
  });
  it("changing the name asks for the sentence again (it has the name in it) and drops the recording of the old one", async () => {
    draw();
    const name = screen.getByLabelText("Your full name (it is part of the consent)");
    fireEvent.change(name, { target: { value: "Anil Reddy" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show the sentence" })));
    await screen.findByText(SENTENCE);
    await record("Record the sentence", 6);
    fireEvent.change(name, { target: { value: "Anil Kumar" } });
    expect(screen.queryByText(SENTENCE)).toBeNull();
    expect(screen.queryAllByLabelText("Listen")).toHaveLength(0);
  });
  it.each([
    [403, { ok: false, mfa: true, code: "mfa_required" }, /authenticator app/],
    [409, { ok: false, code: "voice_exists" }, /A voice exists already/],
    [422, { ok: false, code: "consent_sentence_mismatch" }, /The sentence changed/],
    [502, { ok: false, code: "voice_provider_refused" }, /Nothing was kept/],
    [403, { ok: false, code: "workspace_read_only" }, /read-only/],
    [500, { ok: false, code: "boom" }, /That did not work/],
  ])("a refusal (%s) is said in our words", async (status, body, text) => {
    draw();
    fireEvent.change(screen.getByLabelText("Your full name (it is part of the consent)"), { target: { value: "Anil Reddy" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show the sentence" })));
    await screen.findByText(SENTENCE);
    await record("Record the sentence", 6);
    await record("Record the sample", 21);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Create my voice" })));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
  it("a made voice: who consented and when, how to choose it, and 'Delete my voice' that asks once, says what goes, and only then deletes", async () => {
    draw(READY);
    expect(screen.getByText("Made with the consent of Anil Reddy on 26 Oct 2026.")).toBeInTheDocument();
    expect(screen.getByText(/Choose "My own voice" for the assistant below/)).toBeInTheDocument();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete my voice" })));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("removes the voice and both recordings");
    expect(remove).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Keep it" })));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete my voice" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" })));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalled();
  });
  it("deleting needs the second factor: our sentence and the way to Security", async () => {
    remove.mockResolvedValueOnce({ ok: false, code: "mfa_required", mfa: true });
    draw(READY);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Delete my voice" })));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" })));
    expect(await screen.findByRole("alert")).toHaveTextContent(/authenticator app/);
    expect(screen.getByRole("link", { name: /Security|authenticator/i })).toHaveAttribute("href", "/app/security");
  });
});
