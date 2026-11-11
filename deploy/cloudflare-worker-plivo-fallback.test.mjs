// Run: node --test deploy/cloudflare-worker-plivo-fallback.test.mjs   (no dependency; the numbers below are invented)
import assert from "node:assert/strict";
import test from "node:test";

import worker, { safeSecond } from "./cloudflare-worker-plivo-fallback.js";

const TOKEN = "t".repeat(24);
const base = { PATH_TOKEN: TOKEN, CALLER_ID: "918000000001", FORWARDING_NUMBERS: "919000000002" };

function kv() {
  const rows = new Map();
  return { rows, put: async (k, v) => void rows.set(k, v), get: async (k) => rows.get(k) ?? null, list: async () => ({ keys: [...rows.keys()].map((name) => ({ name })) }) };
}
const call = (env, { from = "917000000003", path = `/${TOKEN}`, body, method = "POST", headers } = {}) =>
  worker.fetch(new Request(`https://fb.example.workers.dev${path}`, { method, body: method === "POST" ? (body ?? `From=${from}&To=918000000001`) : undefined, headers }), env, undefined);

test("with a safe second phone it rings that phone and nothing else", async () => {
  const r = await call({ ...base, SECOND_NUMBER: "917000000009" });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.match(text, /<Number>917000000009<\/Number>/);
  assert.match(text, /callerId="918000000001"/);
  assert.doesNotMatch(text, /919000000002/);
});

test("without a second phone the caller hears the fixed sentence, and the miss is recorded as the last 4 digits only", async () => {
  const MISSED = kv();
  const text = await (await call({ ...base, MISSED })).text();
  assert.match(text, /call again in a few minutes/);
  assert.match(text, /<Hangup\/>/);
  assert.doesNotMatch(text, /<Dial/);
  const [row] = [...MISSED.rows.values()].map((v) => JSON.parse(v));
  assert.deepEqual(Object.keys(row).sort(), ["last4", "reason", "time"]);
  assert.equal(row.last4, "0003");
  assert.equal(row.reason, "no_second_phone");
});

test("loop guard: the shop mobile, or our own number, is never dialled as the second phone", async () => {
  assert.equal(safeSecond({ ...base, SECOND_NUMBER: "+91 90000 00002" }), "");
  assert.equal(safeSecond({ ...base, SECOND_NUMBER: "918000000001" }), "");
  assert.equal(safeSecond({ ...base, SECOND_NUMBER: "917000000009" }), "917000000009");
  const MISSED = kv();
  const text = await (await call({ ...base, SECOND_NUMBER: "919000000002", MISSED })).text();
  assert.doesNotMatch(text, /<Dial/);
  assert.equal(JSON.parse([...MISSED.rows.values()][0]).reason, "second_phone_unsafe");
});

test("loop guard: a call that comes from us or from a forwarding number is never dialled", async () => {
  for (const from of ["918000000001", "919000000002"]) {
    const MISSED = kv();
    const text = await (await call({ ...base, SECOND_NUMBER: "917000000009", MISSED }, { from })).text();
    assert.doesNotMatch(text, /<Dial/);
    assert.match(text, /<Hangup\/>/);
    assert.equal(JSON.parse([...MISSED.rows.values()][0]).reason, "loop_blocked");
  }
});

test("after the Dial: answered ends quietly; not answered gets the sentence and a record", async () => {
  const MISSED = kv();
  const env = { ...base, SECOND_NUMBER: "917000000009", MISSED };
  const answered = await (await call(env, { path: `/${TOKEN}?step=after`, body: "From=917000000003&DialBLegStatus=answer" })).text();
  assert.doesNotMatch(answered, /Speak/);
  assert.equal(MISSED.rows.size, 0);
  const missed = await (await call(env, { path: `/${TOKEN}?step=after`, body: "From=917000000003&DialBLegStatus=no-answer" })).text();
  assert.match(missed, /call again in a few minutes/);
  assert.equal(JSON.parse([...MISSED.rows.values()][0]).reason, "second_phone_unanswered");
});

test("the wrong path, a short token, a bad method and the missed list without its token are all refused", async () => {
  assert.equal((await call(base, { path: "/nope" })).status, 404);
  assert.equal((await call({ ...base, PATH_TOKEN: "short" })).status, 500);
  assert.equal((await call(base, { method: "DELETE" })).status, 405);
  assert.equal((await call({ ...base, READ_TOKEN: "r".repeat(20), MISSED: kv() }, { method: "GET", path: `/${TOKEN}/missed` })).status, 404);
});

test("the owner reads the missed list with the read token", async () => {
  const MISSED = kv();
  const env = { ...base, READ_TOKEN: "r".repeat(20), MISSED };
  await call(env);
  const r = await call(env, { method: "GET", path: `/${TOKEN}/missed`, headers: { authorization: `Bearer ${"r".repeat(20)}` } });
  const body = await r.json();
  assert.equal(body.stored, true);
  assert.equal(body.missed.length, 1);
  assert.equal(body.missed[0].last4, "0003");
});
