/**
 * A new id for an entry, minted on the client side of the sheet ONCE per opening (C1 contract 1.1 part 1, W2: `PUT /what-you-sell/{style}/{id}` with the SAME id again is a retry, never a second row). A UUID (version 4): the browser's own when it has one,
 * else random bytes shaped like one (an old browser, a test). Never used as a secret.
 */
export function newEntryId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
