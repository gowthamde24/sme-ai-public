import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CALL_LANG_NAMES } from "@/lib/assistant/types";

import { Pronunciation } from "./Pronunciation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const entry = { id: "11111111-1111-4111-8111-111111111111", word: "Pochampally", soundsLike: "pochampalli", language: null };
const posts: Record<string, unknown>[] = [];
let answer: (b: Record<string, unknown>) => unknown;

const draw = (canEdit = true, items = [entry]) =>
  render(<Pronunciation initial={{ items, suggestions: [] }} canEdit={canEdit} endpoint="/p" previewEndpoint="/pp" langNames={CALL_LANG_NAMES} defaultLang="te" businessName="Kallu Silks" city="Ananthapuramu" />);

beforeEach(() => {
  posts.length = 0;
  answer = (b) => (b.action === "delete" ? { ok: true } : { ok: true, entry: { id: "22222222-2222-4222-8222-222222222222", word: b.word, soundsLike: b.sounds_like, language: b.language } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).startsWith("/pp")) return { ok: true, blob: async () => new Blob(["x"]) };
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      posts.push(body);
      return { status: 200, json: async () => answer(body) };
    }),
  );
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
  vi.stubGlobal("Audio", class { onended: (() => void) | null = null; onerror: (() => void) | null = null; pause() {} async play() { this.onended?.(); } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Settings > AI assistant > Pronunciation", () => {
  it("lists the words with how they sound, Hear it and Remove, and offers the business's own words", () => {
    draw();
    const row = document.querySelector('[data-part="pron-row"]') as HTMLElement;
    expect(row.textContent).toContain("Pochampally");
    expect(row.textContent).toContain("pochampalli");
    expect(row.querySelector('[data-part="pron-hear"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Kallu" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Ananthapuramu" })).not.toBeNull();
  });
  it("saves a new word (all languages), shows what the route answered, and removes one", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: "Kallu" }));
    expect((screen.getByLabelText("Word") as HTMLInputElement).value).toBe("Kallu");
    fireEvent.change(screen.getByLabelText("Sounds like"), { target: { value: "kallu" } });
    await act(async () => void fireEvent.click(document.querySelector('[data-part="pron-save"]') as HTMLElement));
    expect(posts[0]).toEqual({ action: "save", word: "Kallu", sounds_like: "kallu", language: null });
    expect(document.querySelectorAll('[data-part="pron-row"]').length).toBe(2);
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[0]));
    expect(posts[1]).toEqual({ action: "delete", id: entry.id });
    expect(document.querySelectorAll('[data-part="pron-row"]').length).toBe(1);
  });
  it("says why a save failed, in words", async () => {
    answer = () => ({ ok: false, error: "full" });
    draw();
    fireEvent.change(screen.getByLabelText("Word"), { target: { value: "Uppada" } });
    fireEvent.change(screen.getByLabelText("Sounds like"), { target: { value: "uppada" } });
    await act(async () => void fireEvent.click(document.querySelector('[data-part="pron-save"]') as HTMLElement));
    expect(screen.getByRole("alert").textContent).toContain("full");
  });
  it("Hear it asks the preview route for the sound in the chosen language", async () => {
    draw();
    await act(async () => void fireEvent.click(document.querySelector('[data-part="pron-hear"]') as HTMLElement));
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls.some((c) => c[0].startsWith("/pp?lang=te&word=Pochampally&say=pochampalli"))).toBe(true);
  });
  it("a member who may not change it only reads and hears", () => {
    draw(false);
    expect(document.querySelector('[data-part="pron-remove"]')).toBeNull();
    expect(document.querySelector('[data-part="pron-save"]')).toBeNull();
    expect(document.querySelector('[data-part="pron-hear"]')).not.toBeNull();
  });
});
