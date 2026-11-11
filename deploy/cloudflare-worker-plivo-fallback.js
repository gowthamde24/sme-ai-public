// The FALLBACK for the shop's phone line (docs/runbooks/customer-zero-go-live-checklist.md, section C). Set it as the Plivo application's "Fallback Answer URL": when Plivo cannot get an answer from the API
// (down, rolling back, a timeout), Plivo asks this Worker instead and it answers with XML that rings the shop's own phone. It runs on Cloudflare, so an outage of the API or of Google Cloud cannot take it down.
// Two plain variables on the Worker (Cloudflare dashboard > Workers > Settings > Variables; NEVER in the repository): SHOP_NUMBER (digits with country code, no +; a phone that is NOT forwarded back to
// the Plivo number: see the loop guard in the checklist) and CALLER_ID (the Plivo number that received the call; India requires a number rented on the account). It holds no secret, stores nothing and logs nothing.
// It answers only POST or GET with that one XML; anything else is 405. The XML is the whole answer: <Dial> rings SHOP_NUMBER for up to 25 seconds.
export default {
  async fetch(request, env) {
    if (request.method !== "POST" && request.method !== "GET") return new Response("method not allowed", { status: 405 });
    const shop = String(env.SHOP_NUMBER || "").replace(/\D/g, "");
    const caller = String(env.CALLER_ID || "").replace(/\D/g, "");
    if (shop.length < 10 || shop.length > 15 || caller.length < 10 || caller.length > 15) return new Response("not configured", { status: 500 });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${caller}" timeout="25"><Number>${shop}</Number></Dial></Response>`;
    return new Response(xml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
  },
};
