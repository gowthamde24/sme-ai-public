// The FALLBACK for the shop's phone line (docs/runbooks/customer-zero-go-live-checklist.md, section C). Set it as the Plivo application's "Fallback Answer URL": when Plivo cannot get an answer from the API
// (down, rolling back, a timeout), Plivo asks this Worker instead. It runs on Cloudflare, so an outage of the API or of Google Cloud cannot take it down. It makes NO promise to the caller and holds no secret of Plivo.
//
// What it does (owner decision 11 Nov 2026):
//   1. SECOND_NUMBER is set and safe  -> rings that SECOND phone for 25 seconds. It never rings the shop's own mobile (that mobile forwards to us: it would loop).
//      If nobody answers (or the second phone is busy / switched off) -> step 3.
//   2. SECOND_NUMBER is not set (or is unsafe: see the loop guard) -> step 3.
//   3. The caller hears one short fixed sentence ("... please call again in a few minutes"), then the call ends. The missed call is recorded for the owner (see below).
//
// LOOP GUARD, so the fallback never dials a number that forwards to us (all comparisons on the last 10 digits):
//   * FORWARDING_NUMBERS (comma list: the shop's mobile and any other number that forwards to the Plivo number) can never be dialled: if SECOND_NUMBER is one of them, or is our own CALLER_ID, it is treated as "not set".
//   * A call whose caller (From) is our own CALLER_ID, or one of FORWARDING_NUMBERS, is never dialled either: it can only be our own dialled leg coming back round. It gets the sentence and is recorded as "loop_blocked".
//
// Variables on the Worker (Cloudflare dashboard > Workers > Settings > Variables and Secrets; NEVER in the repository; numbers are digits with country code, no +):
//   PATH_TOKEN         secret   a long random string; the Fallback Answer URL is https://<worker>/<PATH_TOKEN> (anything else is 404: nobody else can make this Worker dial or write)
//   CALLER_ID          the Plivo number that receives the shop's calls (India requires a number rented on the account)
//   SECOND_NUMBER      the second phone to ring (optional; added later by the owner)
//   FORWARDING_NUMBERS comma list of numbers that forward to us (the shop's mobile)
//   MISSED             optional Workers KV binding (free tier). When bound, each missed call is stored for 30 days as {time, last 4 digits, reason}; the number itself stays only in Plivo's own call log.
//   READ_TOKEN         secret, optional: GET https://<worker>/<PATH_TOKEN>/missed with header "authorization: Bearer <READ_TOKEN>" lists the stored missed calls (newest last).
// It stores nothing else and logs nothing.
//
// To confirm on the first real test call (Plivo's documentation was read, this was not yet tried): the field names of the Dial "action" callback (`DialBLegStatus`) and the `<Speak>` voice.

const SENTENCE = "Sorry, we cannot take your call right now. Please call again in a few minutes. Thank you.";
const TTL_SECONDS = 30 * 24 * 3600;

const digits = (value) => String(value || "").replace(/\D/g, "");
const tail = (value) => digits(value).slice(-10);
const validNumber = (value) => digits(value).length >= 10 && digits(value).length <= 15;
const xml = (body) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
const say = () => `<Speak language="en-IN" voice="WOMAN">${SENTENCE}</Speak><Hangup/>`;

/** The numbers that must never be dialled: ours and every one that forwards to us. */
export function blocked(env) {
  const set = new Set(String(env.FORWARDING_NUMBERS || "").split(",").map(tail).filter(Boolean));
  if (validNumber(env.CALLER_ID)) set.add(tail(env.CALLER_ID));
  return set;
}

/** The second phone to ring, or "" when there is none or it is unsafe. */
export function safeSecond(env) {
  if (!validNumber(env.SECOND_NUMBER)) return "";
  return blocked(env).has(tail(env.SECOND_NUMBER)) ? "" : digits(env.SECOND_NUMBER);
}

async function record(env, ctx, from, reason) {
  if (!env.MISSED || typeof env.MISSED.put !== "function") return;
  const when = new Date().toISOString();
  const row = JSON.stringify({ time: when, last4: digits(from).slice(-4), reason });
  const write = env.MISSED.put(`missed:${when}:${crypto.randomUUID().slice(0, 8)}`, row, { expirationTtl: TTL_SECONDS });
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(write);
  else await write;
}

async function fields(request) {
  if (request.method !== "POST") return new URL(request.url).searchParams;
  try { return new URLSearchParams(await request.text()); } catch { return new URLSearchParams(); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const token = String(env.PATH_TOKEN || "");
    if (token.length < 16) return new Response("not configured", { status: 500 });
    const [, first, second] = url.pathname.split("/");
    if (first !== token) return new Response("not found", { status: 404 });

    // the owner's list of missed calls
    if (second === "missed") {
      const read = String(env.READ_TOKEN || "");
      if (request.method !== "GET" || !read || request.headers.get("authorization") !== `Bearer ${read}`) return new Response("not found", { status: 404 });
      if (!env.MISSED || typeof env.MISSED.list !== "function") return Response.json({ missed: [], stored: false });
      const keys = (await env.MISSED.list({ prefix: "missed:" })).keys.slice(-200);
      const rows = await Promise.all(keys.map(async (k) => JSON.parse((await env.MISSED.get(k.name)) || "null")));
      return Response.json({ missed: rows.filter(Boolean), stored: true });
    }

    if (request.method !== "POST" && request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const f = await fields(request);
    const from = f.get("From") || "";

    // step 2 of a call: Plivo comes back here when the Dial ended
    if (url.searchParams.get("step") === "after") {
      if (f.get("DialBLegStatus") === "answer") return xml("<Hangup/>");
      await record(env, ctx, from, "second_phone_unanswered");
      return xml(say());
    }

    // loop guard: a call that comes from us or from a number that forwards to us is never dialled
    if (blocked(env).has(tail(from)) && tail(from) !== "") {
      await record(env, ctx, from, "loop_blocked");
      return xml(say());
    }
    const second_phone = safeSecond(env);
    if (!second_phone) {
      await record(env, ctx, from, validNumber(env.SECOND_NUMBER) ? "second_phone_unsafe" : "no_second_phone");
      return xml(say());
    }
    const caller = digits(env.CALLER_ID);
    if (!validNumber(caller)) return new Response("not configured", { status: 500 });
    const after = `${url.origin}/${token}?step=after`;
    return xml(`<Dial action="${after}" method="POST" callerId="${caller}" timeout="25"><Number>${second_phone}</Number></Dial>`);
  },
};
