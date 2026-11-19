/**
 * The photo or sheet of "What you sell" goes up to this app's OWN route `<workspace>/what-you-sell/upload` (a path it is given): the file as the body, no token, never the API (the route holds the person's token and drops the file through the assistant's file route).
 * The answer is the id of the dropped file for the reading call, or the closed word the sheet has a sentence for (`jobs.sell.file.<word>`).
 */
export type UploadAnswer = { ok: true; fileId: string } | { ok: false; error: "size" | "type" | "empty" | "forbidden" | "down" };

export async function postSellFile(base: string, file: File): Promise<UploadAnswer> {
  try {
    const res = await fetch(`${base}/what-you-sell/upload?${new URLSearchParams({ name: file.name.slice(0, 200) }).toString()}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    const body = (await res.json()) as { ok?: boolean; file_id?: string; error?: string };
    if (body.ok && typeof body.file_id === "string") return { ok: true, fileId: body.file_id };
    return { ok: false, error: body.error === "size" || body.error === "type" || body.error === "empty" || body.error === "forbidden" ? body.error : "down" };
  } catch {
    return { ok: false, error: "down" };
  }
}
