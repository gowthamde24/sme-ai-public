import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEW_PHOTO, PHOTO_A1, photoJson } from "@/lib/api/catalogue-fixtures";

import { photoErrorKey } from "./photo-errors";
import { readAnswer, uploaderFor } from "./upload-client";

class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  responseType = "";
  status = 0;
  responseText = "";
  sent: unknown = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.sent = body;
  }
}
beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));
afterEach(() => vi.unstubAllGlobals());

const good = JSON.stringify({ ok: true, photo: photoJson(NEW_PHOTO, 2), photos: [photoJson(PHOTO_A1, 1), photoJson(NEW_PHOTO, 2)], replayed: false });

describe("the browser's side of an upload", () => {
  it("posts the photo itself with its own type to the route of the saree, naming the photo's id, and reports progress", async () => {
    const upload = uploaderFor("/app/tenants/T/catalogue/I/photos");
    const progress: number[] = [];
    const file = new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" });
    const p = upload(file, NEW_PHOTO, (n) => progress.push(n));
    const x = FakeXhr.last;
    expect([x.method, x.url]).toEqual(["POST", `/app/tenants/T/catalogue/I/photos?photo_id=${NEW_PHOTO}`]);
    expect(x.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(x.sent).toBe(file);
    x.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    x.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    x.upload.onprogress?.({ lengthComputable: false, loaded: 5, total: 0 });
    x.status = 200;
    x.responseText = good;
    x.onload?.();
    const out = await p;
    expect(progress).toEqual([25, 100]);
    expect(out).toMatchObject({ ok: true, photo: { id: NEW_PHOTO } });
    expect(out.ok && out.photos).toHaveLength(2);
  });

  it("a dropped connection, a timeout and an abort are the browser's own codes", async () => {
    for (const [hook, code] of [["onerror", "network"], ["ontimeout", "network"], ["onabort", "aborted"]] as const) {
      const p = uploaderFor("/u")(new File(["x"], "a.jpg", { type: "image/jpeg" }), NEW_PHOTO, () => {});
      FakeXhr.last[hook]?.();
      expect(await p).toEqual({ ok: false, code });
    }
  });

  it("the route's refusal keeps its closed code", async () => {
    const p = uploaderFor("/u")(new File(["x"], "a.jpg", { type: "image/jpeg" }), NEW_PHOTO, () => {});
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = JSON.stringify({ ok: false, code: "photo_too_large" });
    FakeXhr.last.onload?.();
    expect(await p).toEqual({ ok: false, code: "photo_too_large" });
  });
});

describe("reading the route's answer without trusting it", () => {
  it("a success must carry a photo and the photos in the contract's shape", () => {
    expect(readAnswer(200, good)).toMatchObject({ ok: true });
    expect(readAnswer(200, JSON.stringify({ ok: true, photo: { id: "x" }, photos: [] }))).toEqual({ ok: false, code: "bad_answer" });
    expect(readAnswer(200, JSON.stringify({ ok: true, photo: photoJson(NEW_PHOTO, 1), photos: Array.from({ length: 9 }, () => photoJson(NEW_PHOTO, 1)) }))).toEqual({ ok: false, code: "bad_answer" });
    expect(readAnswer(200, JSON.stringify({ ok: true, photo: photoJson(NEW_PHOTO, 1), photos: [photoJson(NEW_PHOTO, 1, { url: "javascript:alert(1)" })] }))).toEqual({ ok: false, code: "bad_answer" });
  });
  it("anything that is not JSON, or an error without a sane code, is a bad answer (or the session, for a 401)", () => {
    expect(readAnswer(502, "<html>")).toEqual({ ok: false, code: "bad_answer" });
    expect(readAnswer(401, "")).toEqual({ ok: false, code: "unauthorized" });
    expect(readAnswer(500, JSON.stringify({ ok: false, code: "A very long English sentence" }))).toEqual({ ok: false, code: "bad_answer" });
    expect(readAnswer(200, "null")).toEqual({ ok: false, code: "bad_answer" });
    expect(readAnswer(200, JSON.stringify({ ok: false }))).toEqual({ ok: false, code: "bad_answer" });
  });
});

describe("the words for a photo that was not stored", () => {
  it("every code the API can give has its own sentence; an unknown one has the general sentence", () => {
    expect(photoErrorKey("photo_too_large")).toBe("catalogue.photo.err.large");
    expect(photoErrorKey("network")).toBe("catalogue.photo.err.net");
    expect(photoErrorKey("who knows")).toBe("catalogue.photo.err.generic");
    expect(photoErrorKey("unauthorized")).toBe("catalogue.photo.err.generic");
  });
});
