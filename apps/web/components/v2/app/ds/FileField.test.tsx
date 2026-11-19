import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appDict } from "@/i18n/app";

import { FileField, fileSize, splitName } from "./FileField";

afterEach(cleanup);
const WORDS = appDict("en") as Record<string, string>;
const file = (name = "gst.pdf", bytes = 12, type = "application/pdf") => new File([new Uint8Array(bytes).fill(37)], name, { type });
const sized = (f: File, size: number) => Object.defineProperty(f, "size", { value: size });
const show = (over: Partial<React.ComponentProps<typeof FileField>> = {}) => {
  const onFile = vi.fn();
  render(
    <>
      <label htmlFor="doc">Your document</label>
      <FileField id="doc" words={WORDS} accept="application/pdf,.pdf,image/png" maxBytes={5_000_000} typeError="Choose a PDF or PNG." sizeError="Over 5 MB." onFile={onFile} help="Up to 5 MB." {...over} />
    </>,
  );
  return onFile;
};
const input = () => screen.getByLabelText("Your document") as HTMLInputElement;
const root = () => document.querySelector('[data-part="file-field"]') as HTMLElement;
const zone = () => root().querySelector("label") as HTMLElement;
const drop = (f: File[]) => fireEvent.drop(zone(), { dataTransfer: { files: f } });

describe("the upload field", () => {
  it("is a real file input behind its label, with the invitation, the help and no error at first", () => {
    show();
    expect(input().type).toBe("file");
    expect(input().accept).toBe("application/pdf,.pdf,image/png");
    expect(input()).toHaveClass("sr-only");
    expect(zone()).toHaveTextContent("Drop your document here or choose a file");
    expect(root()).toHaveTextContent("Up to 5 MB.");
    expect(root()).toHaveAttribute("data-state", "empty");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input()).toHaveAccessibleDescription("Up to 5 MB.");
  });
  it("has an area at least 48 px high (min-h-14 = 56 px; desktop taller) so one tap on a phone opens the picker", () => {
    show();
    expect(zone().className).toMatch(/min-h-14/);
    expect(zone().getAttribute("for")).toBe("doc");
  });
  it("a click on the area is a click on the input (the picker opens): the area is the input's label", () => {
    show();
    const click = vi.fn((e: Event) => e.preventDefault());
    input().addEventListener("click", click);
    fireEvent.click(zone());
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("picks a file through the input: name, size, a green tick and the remove button show, and onFile gets the file", () => {
    const onFile = show();
    const f = file("gst-certificate.pdf", 1_234_567);
    fireEvent.change(input(), { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f, undefined);
    expect(root()).toHaveAttribute("data-state", "chosen");
    expect(root().querySelector('[data-part="file-name"]')).toHaveTextContent("gst-certificate.pdf");
    expect(root().querySelector('[data-part="file-size"]')).toHaveTextContent("1.2 MB");
    expect(root().querySelector('[data-part="file-tick"]')).toHaveClass("rounded-full", "bg-green-text");
    expect(screen.getByRole("button", { name: "Remove the file" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("gst-certificate.pdf chosen, 1.2 MB");
  });
  it("accepts a dropped file, and takes the first when several are dropped", () => {
    const onFile = show();
    const a = file("a.pdf");
    drop([a, file("b.pdf")]);
    expect(onFile).toHaveBeenCalledWith(a, undefined);
    expect(root().querySelector('[data-part="file-name"]')).toHaveTextContent("a.pdf");
  });
  it("shows the drop state while a file is dragged over and clears it on leaving or dropping", () => {
    show();
    fireEvent.dragOver(zone());
    expect(zone().className).toContain("bg-brand-bg");
    fireEvent.dragLeave(zone());
    expect(zone().className).not.toContain("bg-brand-bg");
    fireEvent.dragOver(zone());
    drop([file()]);
    expect(zone().className).not.toContain("bg-brand-bg");
  });
  it("says a wrong kind under the field (role=alert), keeps no file and marks the input invalid", () => {
    const onFile = show();
    fireEvent.change(input(), { target: { files: [file("notes.docx", 10, "application/msword")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF or PNG.");
    expect(onFile).toHaveBeenLastCalledWith(null, "type");
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(root()).toHaveAttribute("data-state", "error");
    expect(root().querySelector('[data-part="file-name"]')).toBeNull();
  });
  it("says a too big file, before reading it, and a wrong dropped file the same way", () => {
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const onFile = show();
    fireEvent.change(input(), { target: { files: [sized(file("big.pdf"), 5_000_001)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Over 5 MB.");
    expect(onFile).toHaveBeenLastCalledWith(null, "size");
    drop([file("x.txt", 5, "text/plain")]);
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF or PNG.");
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
  });
  it("an empty file is its own problem (the kind sentence when no sentence is given)", () => {
    const onFile = show();
    fireEvent.change(input(), { target: { files: [file("e.pdf", 0)] } });
    expect(onFile).toHaveBeenLastCalledWith(null, "empty");
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a PDF or PNG.");
    cleanup();
    show({ emptyError: "Could not read it." });
    fireEvent.change(input(), { target: { files: [file("e.pdf", 0)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not read it.");
  });
  it("the screen's own sentence wins and the accept check can be replaced", () => {
    const onFile = show({ error: "Choose your document.", isAccepted: () => true });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose your document.");
    fireEvent.change(input(), { target: { files: [file("a.anything", 5, "text/x-odd")] } });
    expect(onFile).toHaveBeenLastCalledWith(expect.any(File), undefined);
  });
  it("removes the file with the x: back to the invitation, onFile(null), and the same file can be chosen again", () => {
    const onFile = show();
    fireEvent.change(input(), { target: { files: [file()] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove the file" }));
    expect(onFile).toHaveBeenLastCalledWith(null);
    expect(root()).toHaveAttribute("data-state", "empty");
    expect(zone()).toHaveTextContent("Drop your document here");
    expect(input().value).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("File removed");
  });
  it("the x does not open the picker", () => {
    show();
    fireEvent.change(input(), { target: { files: [file()] } });
    const click = vi.fn();
    input().addEventListener("click", click);
    fireEvent.click(screen.getByRole("button", { name: "Remove the file" }));
    expect(click).not.toHaveBeenCalled();
  });
  it("a new choice replaces the file; a wrong new choice leaves none", () => {
    const onFile = show();
    fireEvent.change(input(), { target: { files: [file("one.pdf")] } });
    const two = file("two.png", 9, "image/png");
    fireEvent.change(input(), { target: { files: [two] } });
    expect(onFile).toHaveBeenLastCalledWith(two, undefined);
    expect(root().querySelector('[data-part="file-name"]')).toHaveTextContent("two.png");
    expect(root().querySelectorAll('[data-part="file-name"]')).toHaveLength(1);
    fireEvent.change(input(), { target: { files: [file("three.exe", 9, "application/x-msdownload")] } });
    expect(onFile).toHaveBeenLastCalledWith(null, "type");
    expect(root().querySelector('[data-part="file-name"]')).toBeNull();
  });
  it("works from the keyboard: the input itself is the focusable control (not hidden, not taken out of the tab order), the focus ring is drawn around the area, and Enter/Space are the browser's own to open the picker", () => {
    show();
    input().focus();
    expect(input()).toHaveFocus();
    expect(input()).not.toHaveAttribute("tabindex");
    expect(input().className).toBe("sr-only");
    expect(zone().className).toContain("has-[:focus-visible]:outline-2");
    expect(zone().className).toContain("has-[:focus-visible]:outline-ring");
  });
  it("the remove button is a real, named button that can be pressed from the keyboard", () => {
    show();
    fireEvent.change(input(), { target: { files: [file()] } });
    const x = screen.getByRole("button", { name: "Remove the file" });
    expect(x.tagName).toBe("BUTTON");
    expect(x).not.toHaveAttribute("tabindex");
    x.focus();
    expect(x).toHaveFocus();
    fireEvent.click(x); // Enter and Space on a button are a click
    expect(root()).toHaveAttribute("data-state", "empty");
  });
  it("disabled: the input is off, a drop does nothing, the x is off", () => {
    const onFile = show({ disabled: true });
    expect(input()).toBeDisabled();
    drop([file()]);
    expect(onFile).not.toHaveBeenCalled();
    expect(zone().className).toContain("cursor-not-allowed");
    fireEvent.change(input(), { target: { files: [file()] } });
    expect(onFile).not.toHaveBeenCalled();
  });
  it("a long name is cut in the middle: the start gives way (truncate), the ending stays, and the full name is the title", () => {
    show();
    const long = "registration-certificate-of-the-company-final-version.pdf";
    fireEvent.change(input(), { target: { files: [file(long)] } });
    const name = root().querySelector('[data-part="file-name"]') as HTMLElement;
    expect(name).toHaveAttribute("title", long);
    expect(name.firstElementChild).toHaveClass("truncate");
    expect(name.lastElementChild).toHaveClass("shrink-0");
    expect(name.lastElementChild?.textContent).toBe(long.slice(-12));
    expect(name.textContent).toBe(long);
    expect(name.className).toContain("min-w-0");
  });
  it("says its words in Telugu", () => {
    show({ words: appDict("te") as Record<string, string> });
    expect(zone()).toHaveTextContent("డాక్యుమెంట్‌ని ఇక్కడికి లాగండి, లేదా ఫైల్ ఎంచుకోండి");
  });
});

describe("the helpers", () => {
  it("writes sizes in decimal units", () => {
    expect([fileSize(0), fileSize(999), fileSize(1000), fileSize(48_400), fileSize(1_234_567), fileSize(5_000_000)]).toEqual(["0 B", "999 B", "1 KB", "48 KB", "1.2 MB", "5.0 MB"]);
  });
  it("keeps a short name whole and the last 12 characters of a long one", () => {
    expect(splitName("gst.pdf")).toEqual({ head: "gst.pdf", tail: "" });
    expect(splitName("a".repeat(30) + ".pdf")).toEqual({ head: "a".repeat(22), tail: "aaaaaaaa.pdf" });
  });
});
