import { NextResponse, type NextRequest } from "next/server";

import { apiPublicStream } from "@/lib/api/client";
import { apiSamplePath } from "@/lib/jobs/sample-audio";

export const dynamic = "force-dynamic";

/**
 * GET /job-samples/{pack}/{id}.{lang}.mp3: the recorded sample voice of a job template (contract 1.1 part 1, section 8 item 1), on OUR site so the page's security policy needs no new source. PUBLIC (no sign-in: it is a sample of our own words, no customer data):
 * nothing of the person reaches the API from here, no cookie and no Authorization header. `pack` and `file` must be exactly the strict shape of lib/jobs/sample-audio.ts, else 404 and the API is not asked. The API's answer is STREAMED back: the Range request header is
 * forwarded and a 206 with its Content-Range comes back as it is (a phone seeks inside the sound), the type is always `audio/mpeg`, and the year-long immutable cache is kept for a good answer only (a 404 or a failure is never cached).
 */
const NOT_THERE = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
/** A byte range such as `bytes=0-` or `bytes=100-199`: the only form forwarded (anything else is dropped, never passed on). */
const RANGE = /^bytes=\d{0,12}-\d{0,12}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ pack: string; file: string }> }) {
  const { pack, file } = await params;
  const path = apiSamplePath(pack, file);
  if (path === null) return NOT_THERE();
  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await apiPublicStream(path, range !== null && RANGE.test(range) ? { Range: range } : {});
  } catch {
    return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  if (upstream.status === 404) return NOT_THERE();
  if (upstream.status === 416) return new NextResponse(null, { status: 416, headers: { "Cache-Control": "no-store", ...(upstream.headers.get("content-range") ? { "Content-Range": upstream.headers.get("content-range") as string } : {}) } });
  if ((upstream.status !== 200 && upstream.status !== 206) || !upstream.body) return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  const length = upstream.headers.get("content-length");
  if (length && /^\d{1,12}$/.test(length)) headers["Content-Length"] = length;
  const contentRange = upstream.headers.get("content-range");
  if (upstream.status === 206) {
    if (!contentRange || !/^bytes \d+-\d+\/(\d+|\*)$/.test(contentRange)) return new NextResponse(null, { status: 502, headers: { "Cache-Control": "no-store" } });
    headers["Content-Range"] = contentRange;
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
