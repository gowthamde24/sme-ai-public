import { cookies } from "next/headers";

import { listMarksBatches, previewMarks, sendMarks } from "@/lib/api/marks";
import { marksScreens } from "@/lib/screens/flag";

import { MOCK_COOKIE, MockRefusal, encodeLog, mockPreview, mockSend, parseLog } from "./mock";
import type { MarksBatch, MarksKind, MarksLang, MarksPreview, MarksSent } from "./types";

/**
 * Where the marks screen gets its preview, its send and its log (job DP). `mock` = lib/marks/mock.ts; `on` = C1's API (lib/api/marks.ts); `off` = the screen is not there. The route handlers and the page call these; a refusal of the
 * fake is the same closed code the API uses. SERVER ONLY.
 */
export type Ctx = { token: string; tenantId: string };
export const marksMode = marksScreens;

export async function preview(ctx: Ctx, file: ArrayBuffer, contentType: string, p: { kind: MarksKind; language: MarksLang; term: string }): Promise<MarksPreview> {
  return marksScreens() === "mock" ? mockPreview(file, p.kind, p.language, p.term) : previewMarks(ctx.token, ctx.tenantId, file, contentType, p);
}

export async function send(ctx: Ctx, file: ArrayBuffer, contentType: string, p: { kind: MarksKind; language: MarksLang; term: string; batchId: string; sha256: string; count: number }): Promise<MarksSent> {
  if (marksScreens() !== "mock") return sendMarks(ctx.token, ctx.tenantId, file, contentType, p);
  const out = mockSend(file, p.kind, p.language, p.term, p.batchId, p.sha256, p.count);
  const jar = await cookies();
  const log = parseLog(jar.get(MOCK_COOKIE)?.value);
  jar.set(MOCK_COOKIE, encodeLog([{ batchId: out.batchId, at: new Date().toISOString(), sent: out.sent, failed: out.failed, blocked: out.blocked }, ...log]), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24, path: "/" });
  return out;
}

/** The send log: newest first, or null when it could not be read ("Not available yet"). */
export async function readLog(ctx: Ctx): Promise<MarksBatch[] | null> {
  try {
    if (marksScreens() === "mock") return parseLog((await cookies()).get(MOCK_COOKIE)?.value);
    return await listMarksBatches(ctx.token, ctx.tenantId);
  } catch {
    return null;
  }
}

export { MockRefusal };
