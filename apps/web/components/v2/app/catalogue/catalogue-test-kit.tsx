import { vi } from "vitest";

import { catalogueWords } from "@/app/app/tenants/[tenantId]/catalogue/catalogue-words";
import { parseItem, parseItemSummary, type Item, type ItemSummary } from "@/lib/api/catalogue";
import { ITEM_A, LEAD_FOUND, NEW_PHOTO, PHOTO_A1, PHOTO_A2, PHOTO_A3, SUMMARIES, itemJson, photoJson } from "@/lib/api/catalogue-fixtures";

import type { EditorActions, SendActions, Uploader } from "./catalogue-types";

/** Shared by the tests of the catalogue screens: the English words, ready items, and actions that can be watched. Test code only. */
export const WORDS = catalogueWords("en");
export const BASE = "/app/tenants/T";
export const item = (over: Record<string, unknown> = {}, photos?: Record<string, unknown>[]): Item => parseItem(itemJson(over, photos));
export const rows = (): ItemSummary[] => SUMMARIES.map(parseItemSummary);
export const IDS = { ITEM_A, PHOTO_A1, PHOTO_A2, PHOTO_A3, NEW_PHOTO, LEAD_FOUND };

export function fakeEditorActions(over: Partial<Record<keyof EditorActions, ReturnType<typeof vi.fn>>> = {}) {
  const actions = {
    save: over.save ?? vi.fn(async (_id: string, input: { active: boolean }) => ({ ok: true as const, item: item({ active: input.active }, []) })),
    remove: over.remove ?? vi.fn(async () => ({ ok: true as const, item: item({}, []) })),
    reorder: over.reorder ?? vi.fn(async () => ({ ok: true as const, item: item() })),
  };
  return actions as unknown as EditorActions & Record<keyof EditorActions, ReturnType<typeof vi.fn>>;
}

export function fakeSendActions(over: Partial<Record<keyof SendActions, ReturnType<typeof vi.fn>>> = {}) {
  const actions = {
    search: over.search ?? vi.fn(async () => ({ ok: true as const, items: [{ leadId: LEAD_FOUND, customer: "Sri Lakshmi Silks", city: "Hyderabad", contactName: "Priya S.", phoneLast4: "0001" }] })),
    send: over.send ?? vi.fn(async () => ({ ok: true as const, state: "sent" as const, text: "Sent to the customer.", why: null, recordText: "Keep a record is on." })),
  };
  return actions as unknown as SendActions & Record<keyof SendActions, ReturnType<typeof vi.fn>>;
}

export const file = (name = "saree.jpg", type = "image/jpeg", bytes = 1000): File => new File([new Uint8Array(bytes)], name, { type });

/**
 * A pretend server for the editor: it remembers the photos and whether the saree is shown, so the steps of a save see what the real API would show them (a saree cannot be shown without a photo, the last photo of a
 * shown saree cannot be taken off, an upload adds a photo at the end, a reorder must name every live photo once).
 */
export function makeWorld(start: Item | null) {
  const state = { photos: (start?.photos ?? []).map((p) => p.id), active: start?.active ?? false };
  const read = (): Item => item({ active: state.active }, state.photos.map((id, i) => photoJson(id, i + 1)));
  const save = vi.fn(async (_id: string, input: { active: boolean }) => {
    if (input.active && state.photos.length === 0) return { ok: false as const, error: "A saree needs at least one photo before it can be shown to customers. Add a photo and save again." };
    state.active = input.active;
    return { ok: true as const, item: read() };
  });
  const remove = vi.fn(async (photoId: string) => {
    if (state.active && state.photos.length <= 1) return { ok: false as const, error: "The last photo of a saree that is shown cannot be removed." };
    state.photos = state.photos.filter((id) => id !== photoId);
    return { ok: true as const, item: read() };
  });
  const reorder = vi.fn(async (_id: string, ids: string[]) => {
    if (ids.length !== state.photos.length || !ids.every((id) => state.photos.includes(id))) return { ok: false as const, error: "Something in the form was not accepted. Check it and try again." };
    state.photos = [...ids];
    return { ok: true as const, item: read() };
  });
  const uploader = vi.fn(async (_blob: Blob, photoId: string, progress: (p: number) => void) => {
    progress(30);
    progress(100);
    if (!state.photos.includes(photoId)) state.photos.push(photoId);
    const photos = read().photos;
    return { ok: true as const, photo: photos.find((p) => p.id === photoId)!, photos };
  });
  return { state, actions: { save, remove, reorder } as unknown as EditorActions & Record<keyof EditorActions, ReturnType<typeof vi.fn>>, uploader: uploader as unknown as Uploader & ReturnType<typeof vi.fn> };
}
