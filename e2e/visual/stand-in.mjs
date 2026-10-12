// The stand-in backend of the visual tests (job BX): ONE small https server that answers for BOTH the Supabase Auth server and the SME AI API, from fixed, invented data (fixtures.mjs).
// No database, no secrets, no network, no real person. It exists so the pages can be drawn exactly the same way on any machine, in CI included.
//   - Auth: GET /auth/v1/user answers for the one invented owner (with a verified authenticator, so the session is "aal2" like a real signed-in owner).
//   - API: GET /v1/... answers from the route table in fixtures.mjs; anything it does not know is a 404 {"error": ...} AND is written to `misses`, so a screen that asks for something new is noticed, not drawn half empty by accident.
//   - POST/PUT/DELETE are refused (405): the visual tests only look, they never change anything.
import { readFileSync } from "node:fs";
import https from "node:https";

import { API_ROUTES, SESSION_USER } from "./fixtures.mjs";

const PALETTES = [["#9b1c2e", "#d4a33b", "#5e0f1b"], ["#1f5f8b", "#7fb7d6", "#123a57"], ["#e7a1b8", "#f6d3df", "#b9667f"], ["#2f7d4f", "#9fd3a8", "#1d4d31"]];
/** A draped-cloth picture (stripes, a border and a few motifs) in a palette: invented, deterministic, 600x800. */
function sareePicture(n) {
  const [main, light, dark] = PALETTES[(n - 1) % PALETTES.length];
  const stripes = Array.from({ length: 12 }, (_, i) => `<rect x="${i * 50}" y="0" width="25" height="800" fill="${i % 2 ? dark : main}" opacity="0.9"/>`).join("");
  const motifs = Array.from({ length: 24 }, (_, i) => `<circle cx="${60 + (i % 6) * 96}" cy="${110 + Math.floor(i / 6) * 150}" r="14" fill="${light}" opacity="0.85"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="${main}"/>${stripes}${motifs}<rect y="700" width="600" height="100" fill="${light}"/><rect y="716" width="600" height="14" fill="${dark}"/></svg>`;
}

export function startStandIn({ port, certPath, keyPath }) {
  const misses = new Set();
  const hits = [];
  const server = https.createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (req, res) => {
    const url = new URL(req.url, "https://stand-in.invalid");
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    hits.push(`${req.method} ${url.pathname}${url.search}`);
    const picture = /^\/storage\/v1\/object\/sign\/catalogue\/(\d+)\.svg$/.exec(url.pathname);
    if (picture) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      return res.end(sareePicture(Number(picture[1])));
    }
    if (url.pathname === "/auth/v1/user") {
      return /^Bearer .+/.test(req.headers.authorization ?? "") ? send(200, SESSION_USER) : send(401, { msg: "no token" });
    }
    if (!url.pathname.startsWith("/v1/")) return send(404, { error: { code: "not_found", message: "stand-in: not an API path" } });
    if (!/^Bearer .+/.test(req.headers.authorization ?? "")) return send(401, { error: { code: "unauthorized", message: "stand-in: no token" } });
    if (req.method !== "GET") return send(405, { error: { code: "method_not_allowed", message: "stand-in: the visual tests only look" } });
    for (const [pattern, answer] of API_ROUTES) {
      const m = pattern.exec(url.pathname);
      if (!m) continue;
      const body = typeof answer === "function" ? answer({ url, match: m }) : answer;
      if (body && typeof body === "object" && "__status" in body) return send(body.__status, body.body);
      return send(200, body);
    }
    misses.add(`${req.method} ${url.pathname}`);
    return send(404, { error: { code: "not_found", message: `stand-in: no fixture for ${url.pathname}` } });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, misses, hits, close: () => new Promise((r) => server.close(() => r())) }));
  });
}
