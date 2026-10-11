import { afterEach, describe, expect, it, vi } from "vitest";

import { LONGEST_SIDE, SHRINK_ABOVE_BYTES, preparePhoto, shouldShrink, shrunkSize } from "./prepare-photo";

afterEach(() => vi.unstubAllGlobals());
const file = (bytes: number, type = "image/jpeg") => new File([new Uint8Array(bytes)], "p.jpg", { type });

describe("getting a photo ready", () => {
  it("shrinks a big file or a big picture, not a small one", () => {
    expect(shouldShrink(SHRINK_ABOVE_BYTES + 1, 800, 600)).toBe(true);
    expect(shouldShrink(100_000, LONGEST_SIDE + 1, 600)).toBe(true);
    expect(shouldShrink(100_000, 1024, 768)).toBe(false);
  });
  it("keeps the proportions and the longest side at most 2048 px", () => {
    expect(shrunkSize(4000, 3000)).toEqual({ width: 2048, height: 1536 });
    expect(shrunkSize(3000, 4000)).toEqual({ width: 1536, height: 2048 });
    expect(shrunkSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(shrunkSize(1, 10000)).toEqual({ width: 1, height: 2048 });
  });

  it("refuses a type the catalogue does not take (an iPhone's HEIC that was not converted, a GIF) without trying", async () => {
    for (const type of ["image/heic", "image/gif", "application/pdf", ""]) expect(await preparePhoto(file(100, type))).toEqual({ ok: false, code: "photo_type_unsupported" });
  });

  it("a browser that cannot shrink sends the original, unless it is over 5 MB", async () => {
    const small = file(2_000_000);
    const out = await preparePhoto(small);
    expect(out.ok && out.blob).toBe(small);
    expect(await preparePhoto(file(5 * 1024 * 1024 + 1))).toEqual({ ok: false, code: "photo_too_large" });
  });

  it("shrinks a big camera photo to a JPEG on a white ground when the browser can, and the smaller one is what goes", async () => {
    const drawn: unknown[] = [];
    const ctx = { fillStyle: "", fillRect: (...a: number[]) => drawn.push(["fill", ...a]), drawImage: (...a: unknown[]) => drawn.push(["draw", ...a.slice(1)]) };
    const shrunk = new Blob([new Uint8Array(900_000)], { type: "image/jpeg" });
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const real = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return real(tag);
      return { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => { drawn.push(["toBlob", type, q]); cb(shrunk); } } as unknown as HTMLCanvasElement;
    });
    const out = await preparePhoto(file(4_500_000));
    expect(out.ok && out.blob).toBe(shrunk);
    expect(drawn).toEqual([["fill", 0, 0, 2048, 1536], ["draw", 0, 0, 2048, 1536], ["toBlob", "image/jpeg", 0.88]]);
    expect(ctx.fillStyle).toBe("#ffffff");
    expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("if shrinking fails, or makes the file bigger, the original goes", async () => {
    const original = file(2_000_000);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("cannot decode"); }));
    expect((await preparePhoto(original) as { blob: Blob }).blob).toBe(original);
  });
});
