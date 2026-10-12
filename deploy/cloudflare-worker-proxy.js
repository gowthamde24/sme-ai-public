// OPTIONAL, for the rehearsal's Cloudflare test only (job CE, docs/runbooks/hosting-rehearsal-owner.md, ADR 0072 option D). A Cloudflare Worker that forwards every request to the web service on Cloud Run,
// so that the browser sees the Worker's address while Cloud Run sees its own. Cloudflare's Free plan cannot rewrite the Host header by rule (Enterprise only); a Worker's request to another address carries
// that address as its Host, which is what Cloud Run needs. Paste this into a Worker in the Cloudflare dashboard and set ONE plain variable on it: ORIGIN = the web service's https://....run.app address.
//
// It forwards the request as it is (method, path, query, headers, body) and adds only X-Forwarded-Host and X-Forwarded-Proto, which say what the browser used. It does NOT follow or rewrite
// redirects, cookies or any other header of the answer: the test must show what the APP does behind a proxy, not what a clever proxy hides. No secret, no logging, no storage.
export default {
  async fetch(request, env) {
    const origin = new URL(env.ORIGIN);
    if (origin.protocol !== "https:") return new Response("ORIGIN must be an https address", { status: 500 });
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, origin);
    const headers = new Headers(request.headers);
    headers.set("X-Forwarded-Host", url.host);
    headers.set("X-Forwarded-Proto", "https");
    // the request body (a photo, at most a few MB) is read whole, so this runs the same in Cloudflare and in the test; the ANSWER is streamed as it arrives (an Ask answer is not held back)
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    return fetch(new Request(target, { method: request.method, headers, body, redirect: "manual" }));
  },
};
