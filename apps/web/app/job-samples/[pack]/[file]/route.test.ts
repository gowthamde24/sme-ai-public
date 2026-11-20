// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const fake = vi.fn();
beforeEach(() => {
  fake.mockReset();
  vi.stubGlobal("fetch", fake);
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const get = (pack: string, file: string, headers: Record<string, string> = {}) => GET(new NextRequest(`http://localhost:3000/job-samples/${pack}/${file}`, { headers }), { params: Promise.resolve({ pack, file }) });
const BYTES = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]);
const audio = (init: ResponseInit = {}) => new Response(BYTES, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": "8", "Set-Cookie": "a=b", ...init.headers }, ...init });

describe("GET /job-samples/{pack}/{id}.{lang}.mp3 (the template sample voices, same-origin)", () => {
  it("streams the API's file as audio/mpeg with the year-long immutable cache and byte ranges; asks the API's path, with no cookie and no Authorization", async () => {
    fake.mockResolvedValueOnce(audio());
    const res = await get("textiles", "enquiry_call_right_away.te.mp3", { cookie: "sb=secret", authorization: "Bearer secret" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("set-cookie")).toBeNull(); // nothing of the API's headers is passed on but the closed ones
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
    expect(fake).toHaveBeenCalledTimes(1);
    const [url, init] = fake.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/job-samples/textiles/enquiry_call_right_away.te.mp3");
    const sent = JSON.stringify(init.headers ?? {}).toLowerCase();
    expect(sent).not.toContain("authorization");
    expect(sent).not.toContain("cookie");
    expect(sent).not.toContain("secret");
    expect(init.method).toBe("GET");
  });
  it("forwards the Range header and answers a 206 with its Content-Range", async () => {
    fake.mockResolvedValueOnce(new Response(BYTES.slice(2, 6), { status: 206, headers: { "Content-Range": "bytes 2-5/8", "Content-Length": "4" } }));
    const res = await get("textiles", "x.en.mp3", { range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/8");
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES.slice(2, 6));
    expect((fake.mock.calls[0][1] as RequestInit).headers).toEqual({ Range: "bytes=2-5" });
  });
  it("a Range that is not a plain byte range is not passed on", async () => {
    fake.mockResolvedValueOnce(audio());
    await get("textiles", "x.en.mp3", { range: "bytes=0-1,5-9" });
    expect((fake.mock.calls[0][1] as RequestInit).headers).toEqual({});
  });
  it("a 206 with no usable Content-Range is a bad gateway, never passed on as a whole file", async () => {
    fake.mockResolvedValueOnce(new Response(BYTES, { status: 206 }));
    expect((await get("textiles", "x.en.mp3", { range: "bytes=0-" })).status).toBe(502);
  });
  it("a range past the end answers 416 and is not cached", async () => {
    fake.mockResolvedValueOnce(new Response(null, { status: 416, headers: { "Content-Range": "bytes */8" } }));
    const res = await get("textiles", "x.en.mp3", { range: "bytes=99-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("404 for a pack or a file that is not the strict shape, and the API is never asked", async () => {
    for (const [pack, file] of [["..", "x.te.mp3"], ["textiles", "../x.te.mp3"], ["textiles", "x.te.wav"], ["textiles", "x.fr.mp3"], ["Textiles", "x.te.mp3"], ["textiles", "x.te.mp3?a=1"], ["a.b", "x.te.mp3"], ["textiles", "x/y.te.mp3"], ["a%2Fb", "x.te.mp3"], ["textiles", "x%2F..%2Fy.te.mp3"], ["textiles", ""]] as const) {
      const res = await get(pack, file);
      expect(res.status, `${pack} ${file}`).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(fake).not.toHaveBeenCalled();
  });
  it("the API's 404 is a 404 that is never cached (a sample that does not exist yet must not stick for a year)", async () => {
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 }));
    const res = await get("textiles", "x.te.mp3");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("any other failure of the API is a 502, never cached; so is an API that cannot be reached", async () => {
    for (const status of [401, 403, 500, 503]) {
      fake.mockResolvedValueOnce(new Response("no", { status }));
      const res = await get("textiles", "x.te.mp3");
      expect(res.status, String(status)).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    fake.mockRejectedValueOnce(new Error("down"));
    expect((await get("textiles", "x.te.mp3")).status).toBe(502);
  });
  it("the origin lock of the API (when set) is the only header added", async () => {
    vi.stubEnv("ORIGIN_LOCK_SECRET", "lock-1");
    fake.mockResolvedValueOnce(audio());
    await get("textiles", "x.te.mp3");
    expect((fake.mock.calls[0][1] as RequestInit).headers).toEqual({ "X-Stack19-Origin": "lock-1" });
  });
});
