import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => undefined }) }));

import { appDict } from "@/i18n/app";

import { MarksSend } from "./MarksSend";

const words = Object.fromEntries(Object.entries(appDict("en") as Record<string, string>).filter(([k]) => k.startsWith("marks.") || k.startsWith("today.err.") || k === "frame.notyet"));
const SHA = "b".repeat(64);
const PREVIEW = { rows: 4, willSend: 2, blocked: 1, unknownGuardian: 1, invalid: 0, duplicates: 0, byTemplate: { "marks.te": 2 }, fileSha256: SHA, issues: [{ line: 3, code: "unknown_guardian", field: "phone" }, { line: 4, code: "duplicate_row", field: null }], issuesTruncated: false, exampleText: "Asha scored 45 out of 50 in Maths." };
const SENT = { sent: 2, failed: 0, blocked: 1, alreadyHandled: 0, skipped: 1, batchId: "b" };
const fetchMock = vi.fn();
const draw = (over: Partial<Parameters<typeof MarksSend>[0]> = {}) => render(<MarksSend base="/app/tenants/T" words={words} canSend mock={false} log={[]} {...over} />);
const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const choose = (name = "marks.csv") => fireEvent.change(screen.getByLabelText("The file (CSV or Excel)"), { target: { files: [new File(["phone,student\n1,2"], name, { type: "text/csv" })] } });
const check = async () => act(async () => void fireEvent.click(screen.getByRole("button", { name: "Show what will be sent" })));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Send marks to parents", () => {
  it("says before anything is chosen that marks are not stored and the file is deleted after sending", () => {
    draw();
    expect(screen.getByText("Marks are not stored. The file is deleted after sending.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show what will be sent" })).toBeDisabled();
    expect(screen.getByText("Nothing has been sent yet.")).toBeInTheDocument();
  });
  it("shows the test-mode note only in test mode", () => {
    const { unmount } = draw({ mock: true });
    expect(screen.getByRole("note")).toHaveTextContent("Test mode: nothing is sent");
    unmount();
    draw();
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("preview: the file goes to the server with its type and the choices; the counts, the problems and the first message are shown, in words", async () => {
    draw();
    choose();
    fireEvent.change(screen.getByLabelText("Exam name (if the file has no exam column)"), { target: { value: "Term 1" } });
    reply(200, { ok: true, data: PREVIEW });
    await check();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/app/tenants/T/marks/preview?kind=marks&language=te&term=Term+1");
    expect(init.method).toBe("POST");
    expect((init.body as File).name).toBe("marks.csv");
    expect(init.headers["Content-Type"]).toBe("text/csv");
    expect(await screen.findByText("Messages to send: 2")).toBeInTheDocument();
    expect(screen.getByText(/Parents who will not get a message: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Line 3: this phone number is not a parent of this school \(column phone\)/)).toBeInTheDocument();
    expect(screen.getByText("Line 4: this line is repeated")).toBeInTheDocument(); // a problem about the whole line has no column
    expect(screen.getByText("Asha scored 45 out of 50 in Maths.")).toBeInTheDocument();
  });
  it("approving sends the SAME file with a batch id and the preview's SHA-256 and count, then says what was sent and that the file was not saved", async () => {
    draw();
    choose();
    reply(200, { ok: true, data: PREVIEW });
    await check();
    reply(200, { ok: true, data: SENT });
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Send messages (2)" })));
    const [url, init] = fetchMock.mock.calls[1];
    const q = new URL(`https://x${url}`).searchParams;
    expect(url).toContain("/marks/send?");
    expect([q.get("expect_sha256"), q.get("expect_count")]).toEqual([SHA, "2"]);
    expect(q.get("batch_id")).toMatch(/^[0-9a-f-]{36}$/);
    expect((init.body as File).name).toBe("marks.csv");
    expect(await screen.findByText("2 sent, 0 could not be sent, 1 blocked, 1 skipped.")).toBeInTheDocument();
    expect(screen.getByText("The file was not saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByLabelText("The file (CSV or Excel)")).toBeNull();
  });
  it("only the Owner can send: an Admin may check the file and is told whom to ask", async () => {
    draw({ canSend: false });
    choose();
    reply(200, { ok: true, data: PREVIEW });
    await check();
    expect(await screen.findByText("Only the Owner can send. Ask the Owner to approve this.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send messages \(\d+\)$/ })).toBeNull();
  });
  it("nothing to send: the button is off and says to fix the file", async () => {
    draw();
    choose();
    reply(200, { ok: true, data: { ...PREVIEW, willSend: 0 } });
    await check();
    expect(await screen.findByRole("button", { name: "Send messages (0)" })).toBeDisabled();
    expect(screen.getByText("Nothing to send. Fix the file and check it again.")).toBeInTheDocument();
  });
  it.each([
    [409, "marks_file_changed", /Nothing was sent\. Check it again/],
    [413, "marks_file_too_large", /3 MB at most/],
    [422, "marks_file_missing_column", /missing a column/],
    [422, "marks_file_not_utf8", /not a CSV or Excel file/],
    [403, "workspace_read_only", /read-only/],
    [403, "module_off", /Only a school/],
    [500, "boom", /That did not work\. Nothing was sent/],
  ])("a refusal (%s %s) is said in our words, and nothing is drawn as sent", async (status, code, text) => {
    draw();
    choose();
    reply(status, { ok: false, kind: "invalid", code, error: "API words" });
    await check();
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText(/API words/)).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
  });
  it("the second factor missing at the send: our sentence and the way to Security; the file stays for a second try", async () => {
    draw();
    choose();
    reply(200, { ok: true, data: PREVIEW });
    await check();
    reply(403, { ok: false, kind: "mfa", mfa: true, code: "mfa_required", error: "x" });
    await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Send messages (2)" })));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/authenticator app/));
    expect(screen.getByRole("link", { name: /Security|authenticator/i })).toHaveAttribute("href", "/app/security");
    expect(screen.getByRole("button", { name: "Send messages (2)" })).toBeEnabled();
  });
  it("a file over 3 MB is refused before it is sent anywhere", async () => {
    draw();
    const big = new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("The file (CSV or Excel)"), { target: { files: [big] } });
    await check();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3 MB at most/);
  });
  it("the log of earlier sends is counts and a time, and says 'Not available yet' when it could not be read", () => {
    const { unmount } = draw({ log: [{ batchId: "b", at: "2026-10-26T10:00:00Z", sent: 5, failed: 1, blocked: 2 }] });
    expect(screen.getByText(/5 sent, 1 failed, 2 blocked/)).toBeInTheDocument();
    unmount();
    draw({ log: null });
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });
});
